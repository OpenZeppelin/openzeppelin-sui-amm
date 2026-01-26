# Prop AMM Move Package

This package contains the Prop AMM Move modules for configuration and execution.
It is experimental and unaudited.

## Purpose

- Define shared configuration for the AMM.
- Provide admin-gated updates and related events.
- Define execution-time state and events for trading.

## Usage

- Publish the package to initialize the admin capability.
- Call `create_amm_config` and then `share_amm_config` to create shared config.
- Call `update_amm_config` with an `AMMAdminCap` to change settings.
