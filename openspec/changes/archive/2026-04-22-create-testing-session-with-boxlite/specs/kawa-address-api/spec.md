## ADDED Requirements

### Requirement: Kawa exposes an HTTP address endpoint
Kawa SHALL start an HTTP server on port 8080 (configurable via `KAWA_ADDRESS_PORT` env var) that serves a `GET /address` endpoint returning her SimpleX connection address as plaintext.

#### Scenario: Address endpoint returns connection link after startup
- **WHEN** Kawa has completed bot profile setup and address creation during startup
- **AND** a client sends `GET /address` to Kawa's HTTP server
- **THEN** the response body contains the SimpleX connection link string
- **AND** the response HTTP status is 200
- **AND** the response `Content-Type` header is `text/plain`

#### Scenario: Address endpoint returns 503 before Kawa is ready
- **WHEN** Kawa has not yet completed bot profile setup and address creation
- **AND** a client sends `GET /address` to Kawa's HTTP server
- **THEN** the response HTTP status is 503 (Service Unavailable)
- **AND** the response body indicates that Kawa is not ready

#### Scenario: Address port is configurable
- **WHEN** the `KAWA_ADDRESS_PORT` environment variable is set to a port number
- **THEN** Kawa's HTTP server listens on that port instead of the default 8080

#### Scenario: Address server starts alongside SimpleX
- **WHEN** Kawa starts up and connects to the SimpleX CLI
- **THEN** the address HTTP server starts listening before or immediately after the SimpleX event loop begins
- **AND** the server does not block Kawa's main event loop