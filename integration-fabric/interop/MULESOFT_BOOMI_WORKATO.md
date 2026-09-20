# iPaaS interoperability

The integration fabric is designed so a customer can connect either **directly** to WFM or through an existing enterprise integration platform.

## MuleSoft

Use `openapi.yaml` with APIkit/HTTP for the northbound WFM contract. Vendor-side adapters can remain in MuleSoft where the customer already standardises integration there. The WFM side accepts the canonical worker, shift, time, production, access and event models.

Supported design targets include REST/OpenAPI, OData, SOAP, GraphQL, AsyncAPI/event streams and gRPC through Mule tooling. WFM must not require MuleSoft: it is an optional transport/orchestration layer.

## Boomi

The same OpenAPI contract is intended to be consumable by Boomi's OpenAPI connector. For legacy/on-prem systems, Boomi can transform or transport to the same canonical endpoints, avoiding a second WFM data model.

## Workato

The same contract is intended to be usable by Workato's OpenAPI connector or converted into a custom connector where customer-specific authentication or UI is needed.

## Other integration platforms

SAP Integration Suite, Oracle Integration Cloud, Azure Logic Apps / Power Automate, Celigo, SnapLogic, Informatica, IBM App Connect, TIBCO and WSO2 should connect through the same public contract instead of requiring WFM-specific payloads.

## Compatibility rule

Interoperability is only considered proven after the OpenAPI document imports cleanly into the target platform and a sandbox round trip has been executed. Documentation compatibility is not equivalent to a tested customer connection.
