## ADDED Requirements

### Requirement: Alice sends image to Kawa
The smoke test suite SHALL include a test where Alice sends an image to Kawa and verifies that Kawa's agent receives and can describe the image content.

#### Scenario: Alice sends image, agent describes it
- **WHEN** Alice sends an image file to Kawa with the message "What is in this image?"
- **THEN** Kawa SHALL auto-accept the image file transfer
- **AND** Kawa SHALL prompt the agent with the text and the image as `ImageContent`
- **AND** Kawa's response SHALL reference the content of the image (not just a generic acknowledgment)

### Requirement: Kawa sends image to Alice
The smoke test suite SHALL include a test where the agent uses the `send_image` tool to send an image to Alice, and Alice receives it.

#### Scenario: Agent sends image via send_image tool
- **WHEN** Alice asks Kawa to "send me the image at <path>"
- **THEN** the agent SHALL call the `send_image` tool with the requested path
- **AND** Alice SHALL receive an inline image in the chat

### Requirement: Kawa sends file to Alice
The smoke test suite SHALL include a test where the agent uses the `send_file` tool to send a file to Alice, and Alice receives it as a file attachment.

#### Scenario: Agent sends file via send_file tool
- **WHEN** Alice asks Kawa to "send me the file at <path>"
- **THEN** the agent SHALL call the `send_file` tool with the requested path
- **AND** Alice SHALL receive a file attachment in the chat

### Requirement: Alice sends file to Kawa
The smoke test suite SHALL include a test where Alice sends a generic file (e.g., a Python source file) to Kawa, and the agent can reference the file content.

#### Scenario: Alice sends a source file, agent reads it
- **WHEN** Alice sends a `.py` file to Kawa with the message "Review this code"
- **THEN** Kawa SHALL auto-accept the file transfer
- **AND** Kawa SHALL save the file to `KAWA_FILES_DIR/files/`
- **AND** Kawa SHALL prompt the agent with the message text plus the file path reference
- **AND** the agent's response SHALL reference the file content (indicating it used its `read` tool)