# What happens when a browser opens an HTTPS site for the first time? {#first-visit}

The browser resolves the hostname, opens TCP, then runs a **one-round-trip TLS 1.3 handshake**. It agrees fresh encryption keys and checks the server's identity before any request is sent.

- The browser sends its key share inside `ClientHello`, so one round trip is enough.[](source:rfc8446)
- After `ServerHello` everything is encrypted, including the server's certificate.[](source:rfc8446)
- `CertificateVerify` proves the server holds the certificate's private key.
- Keys come from ephemeral shares, so a later leak of the private key cannot decrypt this session.

@answer scope="TLS 1.3 over TCP · first visit to a host · no proxy, no resumption"
@meta locale=en
@source rfc8446 title="RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3" url=https://www.rfc-editor.org/rfc/rfc8446

## What crosses the wire before the first request? {#wire}

@sequence id=tls-visit title="First HTTPS visit: DNS to first response"
| actor browser | Browser | frontend |
| actor dns | DNS resolver | external |
| actor server | Web server | backend |
| phase | Name lookup |
| browser | dns | DNS query: example.com |
| dns | browser | IP address | return |
| phase | TCP handshake · 1 RTT |
| browser | server | SYN |
| server | browser | SYN + ACK | return |
| browser | server | ACK |
| phase | TLS 1.3 handshake · 1 RTT |
| browser | server | ClientHello: suites, SNI, key share |
| server | browser | ServerHello: chosen suite, key share | return |
| server | browser | Certificate + CertificateVerify + Finished, encrypted | return |
| browser | server | Finished | emphasis |
| phase | Encrypted HTTP |
| browser | server | GET / |
| server | browser | 200 OK + page | return |

@steps id=visit-steps
| resolve | DNS resolver | Turns the hostname into an IP before the connection can start. | tls-visit | dns |
| hello | Browser | Opens TCP and sends `ClientHello` with TLS 1.3, cipher suites, the hostname and an ephemeral key share. | tls-visit | browser |
| prove | Web server | Sends its key share, then certificate and `Finished` under encryption; checks the client's `Finished`. | tls-visit | server |

@callout id=quic level=note title="What about HTTP/3?"
| With QUIC, the TCP steps disappear: QUIC runs the same TLS 1.3 handshake inside the transport, still in one round trip.

## How does the browser know this is the real site? {#trust}

| Check | What the browser verifies |
| --- | --- |
| Chain | The certificate chains to a root CA in the browser's trust store. |
| Hostname | The site's name appears in the certificate's subject alternative name (SAN) list. |
| Validity | Today sits inside the certificate's not-before and not-after dates. |
| Ownership | `CertificateVerify` signs the handshake transcript; only the private-key holder could produce it. |
| Revocation | Stapled OCSP or CRLs, checked best-effort; many browsers accept an unreachable check. {caution:Weak} |

## Where do the session keys come from? {#keys}

@facts id=key-facts
| Key shares | Each side sends an ephemeral Diffie-Hellman share, usually X25519. |
| Shared secret | Each side combines its private share with the peer's public share. |
| Key schedule | HKDF expands the secret plus the transcript into handshake, then traffic keys. |
| Forward secrecy | Shares are discarded after use, so later key theft cannot decrypt this session. |
| Client `Finished` | Confirms both sides hold the same keys; the request can now ride on them. |

## What changes on the next visit? {#revisit}

| Aspect | First visit | Resumed visit |
| --- | --- | --- |
| Server proof | Full certificate and signature check | Pre-shared key from a `NewSessionTicket` |
| Round trips to first byte | DNS + TCP + 1 RTT of TLS | TCP, then data can ride with `ClientHello` {good:0-RTT} |
| Early data risk | None; the request waits for `Finished` | 0-RTT data can be replayed, so servers limit what it may do {caution:Replayable} |
