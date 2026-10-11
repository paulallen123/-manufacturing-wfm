'use strict';
const {createHash}=require('node:crypto');
// Install the deny-only revocation hook on the canonical tables. Database triggers
// cover every connection and run inside the caller's account mutation transaction.
// Revocation/audit failure therefore rolls back the account mutation as well.
function installOrganisationAccessLifecycle(db){
  db.exec(`CREATE TABLE IF NOT EXISTS organisation_authority_epochs(tenant TEXT PRIMARY KEY,revision INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS organisation_authority_epoch_durable BEFORE DELETE ON organisation_authority_epochs BEGIN SELECT RAISE(ABORT,'Authority history cannot be deleted'); END;
    CREATE TRIGGER IF NOT EXISTS organisation_authority_epoch_monotonic BEFORE UPDATE ON organisation_authority_epochs WHEN NEW.tenant<>OLD.tenant OR NEW.revision<=OLD.revision BEGIN SELECT RAISE(ABORT,'Authority revision must increase'); END;`);
  const bump=which=>`INSERT INTO organisation_authority_epochs(tenant,revision) VALUES(${which}.tenant,1) ON CONFLICT(tenant) DO UPDATE SET revision=revision+1;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS organisation_authority_user_added AFTER INSERT ON users BEGIN ${bump('NEW')} END;
    CREATE TRIGGER IF NOT EXISTS organisation_authority_user_deleted AFTER DELETE ON users BEGIN ${bump('OLD')} END;
    CREATE TRIGGER IF NOT EXISTS organisation_authority_user_changed AFTER UPDATE OF email,tenant,person_id,role,costs,permissions ON users
    WHEN NEW.email IS NOT OLD.email OR NEW.tenant IS NOT OLD.tenant OR NEW.person_id IS NOT OLD.person_id OR NEW.role IS NOT OLD.role OR NEW.costs IS NOT OLD.costs OR NEW.permissions IS NOT OLD.permissions
    BEGIN ${bump('OLD')} ${bump('NEW')} END;`);
  const reasonHash=createHash('sha256').update('canonical-account-access-revoked').digest('hex');
  const bound="tenant=OLD.tenant AND lower(owner_email)=lower(OLD.email)";
  const active=`EXISTS(SELECT 1 FROM organisation_access_initial_authority WHERE ${bound} AND state<>'REVOKED')`;
  const close=`UPDATE organisation_access_setup SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ${bound};
    UPDATE implementation_invitations SET status='REVOKED',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE tenant=OLD.tenant AND contract_ref_hash IN(SELECT r.contract_ref_hash FROM implementation_runs r JOIN organisation_access_setup o ON o.tenant=r.tenant AND o.run_id=r.id WHERE o.tenant=OLD.tenant AND lower(o.owner_email)=lower(OLD.email));
    UPDATE implementation_notification_outbox SET state='BLOCKED',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE tenant=OLD.tenant AND invitation_id IN(SELECT id FROM implementation_invitations WHERE tenant=OLD.tenant AND status='REVOKED');
    UPDATE organisation_access_initial_authority SET state='REVOKED' WHERE ${bound} AND state<>'REVOKED';
    INSERT INTO organisation_access_setup_events(tenant,run_id,action,revision,detail_json,created_at)
      SELECT tenant,run_id,'INITIAL_OWNER_ACCESS_REVOKED',revision,'{"reasonHash":"${reasonHash}"}',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM organisation_access_setup WHERE ${bound};`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS organisation_owner_account_deleted BEFORE DELETE ON users WHEN ${active} BEGIN ${close} END;
    CREATE TRIGGER IF NOT EXISTS organisation_owner_authority_removed BEFORE UPDATE OF email,tenant,role,permissions ON users
    WHEN ${active} AND (NEW.email<>OLD.email OR NEW.tenant<>OLD.tenant OR NEW.role NOT IN ('manager','director','supervisor','company-admin')
      OR CASE WHEN json_valid(NEW.permissions) THEN NOT EXISTS(SELECT 1 FROM json_each(NEW.permissions) WHERE value='company.configure') ELSE 1 END)
    BEGIN ${close} END;`);
}
module.exports={installOrganisationAccessLifecycle};
