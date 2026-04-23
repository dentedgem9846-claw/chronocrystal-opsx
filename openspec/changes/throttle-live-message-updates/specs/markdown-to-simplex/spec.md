## ADDED Requirements

### Requirement: Convert standard markdown to SimpleX dialect
The EventFormatter's `extractMessageText` method SHALL convert standard/CommonMark markdown syntax to SimpleX Chat's markdown dialect before returning text for live messages. The conversion SHALL preserve the formatting intent while matching SimpleX's parser expectations.

#### Scenario: Bold conversion
- **WHEN** `extractMessageText` receives text containing `**bold text**`
- **THEN** the output SHALL contain `*bold text*`
- **AND** the text SHALL render as bold in SimpleX Chat

#### Scenario: Italic conversion
- **WHEN** `extractMessageText` receives text containing `*italic text*`
- **THEN** the output SHALL contain `_italic text_`
- **AND** the text SHALL render as italic in SimpleX Chat

#### Scenario: Double underscore bold conversion
- **WHEN** `extractMessageText` receives text containing `__bold text__`
- **THEN** the output SHALL contain `_bold text_` (SimpleX uses `_` for italic, no separate bold-from-underscores format)
- **AND** the text SHALL render as italic in SimpleX Chat

#### Scenario: Strikethrough conversion
- **WHEN** `extractMessageText` receives text containing `~~struck text~~`
- **THEN** the output SHALL contain `~struck text~`
- **AND** the text SHALL render as strikethrough in SimpleX Chat

#### Scenario: Inline code preservation
- **WHEN** `extractMessageText` receives text containing `` `code` ``
- **THEN** the output SHALL contain `` `code` `` unchanged
- **AND** the text SHALL render as monospace code in SimpleX Chat

#### Scenario: Code block preservation
- **WHEN** `extractMessageText` receives text containing a fenced code block (` ``` ` delimiters)
- **THEN** the output SHALL contain the fenced code block unchanged
- **AND** the content inside the code block SHALL NOT be converted

#### Scenario: Heading conversion (hash to plain text)
- **WHEN** `extractMessageText` receives text starting with `# Heading`
- **THEN** the `#` and space SHALL be removed
- **AND** the output SHALL contain the heading text without the `#` prefix
- **AND** the heading text SHALL NOT be wrapped in `#...#` (SimpleX treats `#` as Secret/hidden text, not headings)

#### Scenario: Heading with multiple hashes
- **WHEN** `extractMessageText` receives text starting with `## Subheading` or `### Sub-subheading`
- **THEN** all leading `#` characters and the following space SHALL be removed
- **AND** the output SHALL contain the heading text without any `#` prefix

#### Scenario: Link preservation
- **WHEN** `extractMessageText` receives text containing `[link text](https://example.com)`
- **THEN** the output SHALL contain `[link text](https://example.com)` unchanged
- **AND** the link SHALL render as a clickable hyperlink in SimpleX Chat

#### Scenario: Unicode emoji preservation
- **WHEN** `extractMessageText` receives text containing Unicode emojis (🔧, ✓, ✗, ⚠, etc.)
- **THEN** the emojis SHALL pass through unchanged
- **AND** the emojis SHALL render correctly in SimpleX Chat

#### Scenario: Newline preservation
- **WHEN** `extractMessageText` receives text containing `\n` newline characters
- **THEN** the newlines SHALL pass through unchanged

#### Scenario: Nested formatting
- **WHEN** `extractMessageText` receives text containing `***bold italic***`
- **THEN** the output SHALL contain `_*bold italic*_`
- **AND** the `*` wraps bold and `_` wraps italic per SimpleX conventions

#### Scenario: Plain text pass-through
- **WHEN** `extractMessageText` receives text with no markdown syntax
- **THEN** the text SHALL pass through unchanged

### Requirement: Conversion only applies to agent message text
The markdown dialect conversion SHALL only apply to text extracted from agent messages via `extractMessageText`. Tool marker formatting (`🔧 bash: ...`) and other EventFormatter output SHALL NOT be subject to dialect conversion.

#### Scenario: Tool markers not double-converted
- **WHEN** `formatEventAppend` produces a tool marker string `🔧 bash: ls -la ✓`
- **THEN** the tool marker SHALL NOT pass through the markdown dialect conversion
- **AND** the tool marker SHALL appear as-is in the live message

### Requirement: Code blocks protect inner content from conversion
Content inside fenced code blocks (``` delimiters) SHALL NOT be subject to markdown dialect conversion. Characters that look like markdown syntax inside code blocks SHALL be left unchanged.

#### Scenario: Markdown-like syntax inside code blocks
- **WHEN** `extractMessageText` receives text containing a code block with `**pointer` inside it
- **THEN** the `**pointer` inside the code block SHALL be left unchanged
- **AND** only markdown syntax outside code blocks SHALL be converted

### Requirement: Preserving SimpleX-native formatting
The conversion SHALL NOT modify text that is already in SimpleX's markdown format. If text already uses SimpleX syntax (`*bold*`, `_italic_`, `~strike~`), it SHALL pass through unchanged.

#### Scenario: Already-correct SimpleX bold
- **WHEN** `extractMessageText` receives text containing `*correct bold*`
- **THEN** the output SHALL contain `*correct bold*` unchanged

#### Scenario: Already-correct SimpleX italic
- **WHEN** `extractMessageText` receives text containing `_correct italic_`
- **THEN** the output SHALL contain `_correct italic_` unchanged