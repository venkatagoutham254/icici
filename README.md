# ICICI — Account Opening console

The branch-facing screen a relationship manager uses to open a savings account.
Identity, tax and document checks are not built here; they are Protean's APIs,
consumed through Protean's gateway.

## What each step does

| Step | What the bank is doing | Protean product | Billed as |
|---|---|---|---|
| 1 | Verify the applicant is who they say | Aadhaar eKYC | `ekyc_otp_sent`, `ekyc_verifications` |
| 2 | Confirm PAN is active and linked | PAN Verification | `pan_verifications`, `pan_link_checks` |
| 3 | Collect address and ID proofs | DigiLocker | `documents_fetched` |
| 4 | Sign the application | Aadhaar eSign | `esign_requests` |

Listing DigiLocker documents is free; each document actually fetched is billed.
Charging for the list as well would double a partner's usage for something they
experience as one action.

## Running it

```bash
cp .env.example .env      # fill in the identity Protean issued to ICICI
node scripts/generate-session.js
docker compose up -d      # http://localhost:4000
```

`generate-session.js` mints ICICI's access token and writes `public/session.json`.
It refuses to run while `.env` still holds placeholders — a console that starts
with no real identity produces events the ingestor rejects for a missing
customer, which surfaces later as an empty usage report rather than as the
configuration mistake it is.

It also writes `protean-gateway-public-key.pem`. Set that as `jwt_public_key` on
Protean's gateway so it can verify the token.

## Where ICICI's metering code lives

Nowhere. There is no usage tracking in this repository, and that is the point.
Protean's gateway authenticates the call, meters it, and reports it to Aforo.
ICICI integrates against an API and receives an invoice.

The **Billable usage this session** panel counts locally, for the operator's own
reconciliation. It is not what the invoice is built from — Aforo is — and the
two are deliberately independent so a discrepancy is visible rather than hidden.

## Identity and what is never held

The console sends a JWT; the gateway verifies it and forwards the verified
`customer_id` to Protean. ICICI never receives a full Aadhaar number — the eKYC
response returns `XXXX XXXX 1234` and nothing more, so there is no full number
in the browser, in the console's memory, or in any log it writes.

For eSign, only the document's SHA-256 is sent. The application form itself never
leaves the bank.

## Errors

Protean returns `errorCode`, `message` and `resolution` on every failure. The
console shows the resolution, because it is written for the person on the phone
to the applicant — a locked Aadhaar tells them to unlock it on the UIDAI portal,
which is an instruction the relationship manager can actually give.
