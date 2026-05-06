export const MOVE_TOML = `[package]
name = "Fixture"
version = "0.0.1"

[dependencies]
Sui = { local = "../sui" }

[dep-replacements.test-publish]
Sui = { local = "../sui" }

[dev-dependencies]
Sui = { local = "../sui" }
`

export const MOVE_LOCK_PINNED = `[move]
version = 1

[pinned.test-publish.Sui]
source = { git = "https://github.com/MystenLabs/sui.git", rev = "1111111", subdir = "crates/sui-framework" }

[pinned.testnet.Sui_1]
source = { git = "https://github.com/MystenLabs/sui.git", rev = "2222222", subdir = "crates/sui-framework" }

[pinned.testnet.MoveStdlib_1]
source = { git = "https://github.com/MystenLabs/sui.git", rev = "3333333", subdir = "crates/sui-framework" }

[pinned.test-publish.Custom]
source = { git = "https://example.com/custom.git", rev = "abcd" }
`

export const MOVE_LOCK_LEGACY = `[[move.package]]
id = "Sui"
source = { git = "https://github.com/MystenLabs/sui.git", rev = "aaaa" }

[[move.package]]
id = "MoveStdlib"
source = { git = "https://github.com/MystenLabs/sui.git", rev = "bbbb" }

[[move.package]]
id = "Other"
source = { git = "https://github.com/example.com/other.git", rev = "cccc" }
`

export const PUBLISHED_TOML = `[published.localnet]
package-id = "0x1"
published-at = "2024-01-01T00:00:00Z"

[published.testnet]
package-id = "0x2"
`
