# Company marks

`apple.ico` was retrieved from https://www.apple.com/favicon.ico on 2026-10-25.
It is Apple's official website icon, used to identify Apple Inc. (US ticker AAPL).
Apple's marks remain the property of Apple Inc.; inclusion does not imply endorsement.

Other company marks use the configured data provider's logo metadata when available.
Missing or failed images fall back to the ticker; company domains are never guessed
from ticker text. The local identity mapping is scoped by country and ticker.

`mtar.png` was retrieved from
https://mtar.in/wp-content/uploads/2025/07/cropped-cropped-MTAR-Logo-icon-180x180-1-192x192.png
on 2026-11-01. It is the official 192px company icon linked from https://mtar.in/,
used to identify MTAR Technologies Limited (India, NSE ticker MTARTECH).
The unmodified mark remains the property of MTAR Technologies Limited; inclusion
identifies the company and does not imply endorsement.

Verified identities and their official asset URLs are maintained in
`src/components/research/companyIdentities.ts`; these are supplemental to provider
metadata and use the same rendering and image-error fallback for every company.
