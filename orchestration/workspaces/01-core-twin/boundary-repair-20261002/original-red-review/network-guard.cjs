'use strict';
// Preload for repository tests. Refuse all real network effects while preserving
// injected in-process synthetic client functions and built-in Response objects.
const forbidden=()=>{throw Error('TRUST_REVIEW_NETWORK_FORBIDDEN');};
globalThis.fetch=forbidden;
for(const name of ['node:http','node:https']){const api=require(name);api.request=forbidden;api.get=forbidden;}
require('node:net').connect=forbidden;
require('node:tls').connect=forbidden;
