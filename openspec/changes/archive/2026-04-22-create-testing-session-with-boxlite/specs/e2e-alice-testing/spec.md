## ADDED Requirements

### Requirement: Kawa HTTP address API on port 8080
Kawa SHALL expose an HTTP endpoint `GET /address` on port 8080 (configurable via `KAWA_ADDRESS_PORT`) that returns her SimpleX connection address as plaintext. Kawa SHALL also expose a `POST /connect` endpoint that accepts a SimpleX connection link and initiates a connection. The API starts after Kawa's bot profile is set up and the address is available.

#### Scenario: GET /address returns the connection link
- **WHEN** a client sends `GET /address` to Kawa's HTTP server
- **AND** Kawa has completed bot profile setup and address creation
- **THEN** the response body contains the SimpleX connection link string
- **AND** the response status is 200

#### Scenario: GET /address before Kawa is ready
- **WHEN** a client sends `GET /address` to Kawa's HTTP server
- **AND** Kawa has not yet completed bot profile setup
- **THEN** the response status is 503 (Service Unavailable)
- **AND** the response body indicates Kawa is not ready yet

#### Scenario: Address API port is configurable
- **WHEN** the `KAWA_ADDRESS_PORT` environment variable is set
- **THEN** Kawa's HTTP server listens on that port instead of the default 8080

#### Scenario: POST /connect initiates a connection
- **WHEN** a client sends `POST /connect` to Kawa's HTTP server with a SimpleX connection link in the request body
- **AND** Kawa's ChatClient is connected
- **THEN** Kawa calls `apiConnectActiveUser()` with the link
- **AND** the response status is 200 with body "Connection initiated"

#### Scenario: POST /connect with missing link
- **WHEN** a client sends `POST /connect` with an empty request body
- **THEN** the response status is 400 with body "Missing connection link in request body"

#### Scenario: POST /connect when Kawa is not ready
- **WHEN** a client sends `POST /connect` to Kawa's HTTP server
- **AND** Kawa's ChatClient is not yet connected
- **THEN** the response status is 503

### Requirement: Smoke test suite using vitest
Kawa SHALL have an end-to-end smoke test suite under `flux/kawa/tests/e2e/` that runs via `npm run smoke` (separate from `npm test`). Tests use vitest as the runner with long timeouts appropriate for LLM-driven responses.

#### Scenario: Smoke tests run separately from unit tests
- **WHEN** a developer runs `npm test`
- **THEN** only fast unit tests execute (no LLM calls, no SimpleX connections)
- **AND** when a developer runs `npm run smoke`
- **THEN** the e2e smoke test suite executes with extended timeouts

#### Scenario: Smoke test timeout accommodates LLM responses
- **WHEN** a smoke test sends a message to Kawa that triggers an LLM response
- **THEN** the test timeout is at least 60 seconds per test
- **AND** the test does not time out during normal LLM operation

### Requirement: Test environment uses host-based process isolation
The smoke test harness SHALL start Kawa and Alice as separate host processes with isolated data directories and ports. Both Kawa's and Alice's simplex-chat CLIs connect outbound to the public SMP relay. Kawa's tool calls run natively in the host working directory.

#### Scenario: Kawa runs as separate host process with isolated data dirs
- **WHEN** the test harness starts
- **THEN** Kawa runs as a child process with its own `simplex-chat` data directory on the host
- **AND** Kawa connects outbound to the public SMP relay
- **AND** Kawa's tool calls run natively on the host
- **AND** Kawa's address API is accessible from the host at `http://localhost:18080/address`

#### Scenario: Alice runs as separate host process with isolated data dirs
- **WHEN** the test harness starts
- **THEN** Alice's `simplex-chat` CLI runs on the host machine on an isolated port
- **AND** Alice connects to the public SMP relay outbound, same as Kawa
- **AND** Kawa and Alice communicate through the relay

#### Scenario: Processes terminated after test suite
- **WHEN** the smoke test suite finishes
- **THEN** Kawa and Alice processes are terminated
- **AND** temp directories on the host are cleaned up

### Requirement: Programmatic Alice-Kawa connection via address API
The test harness SHALL connect Alice to Kawa by poking the address API and using the returned link. No stdout parsing or shared volumes.

#### Scenario: Test harness gets address from Kawa's API
- **WHEN** the test harness sends `GET http://localhost:18080/address`
- **AND** Kawa is fully initialized
- **THEN** the response body contains Kawa's SimpleX connection link
- **AND** the test harness uses this link to connect Alice

#### Scenario: Test harness polls until Kawa is ready
- **WHEN** the test harness starts
- **THEN** it polls `GET http://localhost:18080/address` with retries and a timeout
- **AND** proceeds only after receiving a 200 response with a valid link

#### Scenario: Alice connects to Kawa via the link
- **WHEN** the test harness calls `apiConnectByLink(link)` on Alice's `ChatClient`
- **THEN** Alice connects to Kawa through the public SMP relay
- **AND** a `contactConnected` event fires on both sides

### Requirement: Minimal test helpers over the SDK
The smoke test suite SHALL use minimal helper functions built directly on the `simplex-chat` SDK. No framework abstractions.

#### Scenario: `send` helper sends a message and returns
- **WHEN** a test calls `send(chatClient, contactId, text)`
- **THEN** the text message is sent to the specified contact via `ChatClient.apiSendTextMessage()`

#### Scenario: `waitForMessage` helper returns matching message
- **WHEN** a test calls `waitForMessage(chatClient, matcher, timeoutMs)`
- **THEN** the helper polls incoming events until a message matches the matcher function
- **AND** returns the matching message content
- **AND** throws if no match within the timeout

### Requirement: Create and destroy test environment per suite run
The test environment SHALL be created once in `beforeAll` and destroyed in `afterAll`. Between individual tests, `/new` resets Kawa's session state. No filesystem snapshot/rollback.

#### Scenario: Processes created once in beforeAll
- **WHEN** the smoke test suite starts
- **THEN** Kawa and Alice simplex-chat processes are started on the host with isolated data directories
- **AND** the test harness polls Kawa's address API until ready
- **AND** Alice connects to Kawa via the relay

#### Scenario: Session reset between tests via /new
- **WHEN** a test finishes
- **THEN** Alice sends `/new` to Kawa to reset the session state
- **AND** the next test starts with a clean conversation context

#### Scenario: Processes destroyed in afterAll
- **WHEN** all tests in the suite have completed
- **THEN** Kawa and Alice processes are terminated
- **AND** temp directories on the host are cleaned up

### Requirement: Alice's greeting user story
Alice SHALL receive a greeting message when she first connects to Kawa.

#### Scenario: Alice sees greeting on connect
- **WHEN** Alice connects to Kawa
- **THEN** Alice receives a message containing a greeting (e.g., text matching `👋`)
- **AND** the message identifies Kawa as a coding agent

### Requirement: Alice's `/help` user story
Alice SHALL receive a list of available commands when she sends `/help`.

#### Scenario: Alice sends /help
- **WHEN** Alice sends `/help` to Kawa
- **THEN** Alice receives a response listing available slash commands
- **AND** the response includes `/help`, `/new`, `/compact`, and `/status`

### Requirement: Alice's simple prompt user story
Alice SHALL receive a streamed live message response when she sends a simple question.

#### Scenario: Alice asks a simple question
- **WHEN** Alice sends "What is 2+2?"
- **THEN** Kawa starts a live message that streams text as the LLM generates it
- **AND** the live message is finalized (live=false) when the agent turn completes
- **AND** the final message contains a response addressing the question

### Requirement: Alice's code execution user story
Alice SHALL see inline tool calls and their results when she asks Kawa to perform a coding task. Tool execution happens natively in Kawa's working directory on the host.

#### Scenario: Alice asks to create a file
- **WHEN** Alice sends "Create a file called hello.txt with the content 'world'"
- **THEN** Alice sees an inline `🔧 write: hello.txt` tool execution event in the live message
- **AND** Alice sees a `✓` indicating the tool succeeded
- **AND** the file `hello.txt` exists in Kawa's working directory

#### Scenario: Alice asks to run a command
- **WHEN** Alice sends "Run `ls` and show me the output"
- **THEN** Alice sees an inline `🔧 bash: ls` tool execution event in the live message
- **AND** the command executed in Kawa's working directory

### Requirement: Alice's queued message user story
Alice SHALL have all her messages answered, even when sent while Kawa is streaming a response.

#### Scenario: Alice sends follow-up while streaming
- **WHEN** Alice sends message A and Kawa begins streaming a response
- **AND** Alice sends message B while Kawa is still streaming
- **THEN** Kawa queues message B via `session.followUp()`
- **AND** after the first response completes, Kawa processes message B
- **AND** Alice receives a response to both message A and message B

#### Scenario: Multiple queued messages all answered
- **WHEN** Alice sends messages A, B, and C in quick succession
- **THEN** Kawa responds to all three messages in order
- **AND** no messages are silently lost

### Requirement: Alice's `/new` user story
Alice SHALL get a fresh session when she sends `/new`, with the old session properly aborted.

#### Scenario: Alice sends `/new` while idle
- **WHEN** Alice sends `/new` while Kawa is not streaming
- **THEN** Kawa replies confirming a fresh session
- **AND** subsequent messages start with a clean conversation context

#### Scenario: Alice sends `/new` while streaming
- **WHEN** Alice sends `/new` while Kawa is streaming a response
- **THEN** Kawa aborts the current LLM turn via `session.abort()`
- **AND** Kawa creates a new `AgentSession`
- **AND** Kawa replies confirming a fresh session
- **AND** no stuck live message remains from the old session

### Requirement: Black-box test isolation
The smoke test harness SHALL treat Kawa as a black box. Tests configure Kawa exclusively through environment variables and its HTTP address API. The test harness SHALL NOT wrap, patch, or intercept Kawa's internal subprocess management. All Kawa configuration that the test harness needs (data directory, ports, bot display name) SHALL be exposed as environment variables, and the test harness SHALL pass them as env vars when spawning Kawa — not via wrapper scripts or shell scripts that modify how Kawa starts its internals.

#### Scenario: Kawa is started with env vars only
- **WHEN** the test harness starts Kawa
- **THEN** Kawa is spawned as `node dist/kawa.js` with environment variables for configuration
- **AND** no wrapper script or shell script wraps Kawa's simplex-chat subprocess
- **AND** Kawa handles its own subprocess flags (`--create-bot-display-name`, `-d`) internally

#### Scenario: Test harness does not modify production logic
- **WHEN** a developer reviews the test setup
- **THEN** no test code patches or wraps Kawa's internal binaries
- **AND** all test-to-Kawa configuration flows through Kawa's documented env vars (`KAWA_SIMPLEX_PORT`, `KAWA_ADDRESS_PORT`, `KAWA_SIMPLEX_BIN`, `KAWA_SIMPLEX_DATA_DIR`, etc.)
- **AND** the only external interfaces the test uses are the address API and the SimpleX messaging protocol

#### Scenario: Kawa data directory is configurable
- **WHEN** the `KAWA_SIMPLEX_DATA_DIR` environment variable is set
- **THEN** Kawa passes that directory to its simplex-chat subprocess via `-d`
- **AND** if not set, Kawa uses the simplex-chat default data directory

### Requirement: Platform detection for test prerequisites
The smoke test runner SHALL detect whether required prerequisites (`simplex-chat` CLI, Ollama) are available and skip gracefully with a clear message if not.

#### Scenario: simplex-chat CLI available
- **WHEN** the smoke test runner checks for prerequisites
- **AND** `simplex-chat` is available on the host
- **AND** Ollama is running
- **THEN** the smoke tests proceed normally

#### Scenario: Missing prerequisites
- **WHEN** the smoke test runner checks for prerequisites
- **AND** `simplex-chat` or Ollama is not available
- **THEN** the smoke tests fail with a descriptive error message
- **AND** the error message identifies which prerequisite is missing and how to install it
