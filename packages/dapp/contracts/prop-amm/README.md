# Prop AMM Move Package

This package contains the Prop AMM Move modules for configuration and execution.
It is experimental and unaudited.

## Purpose

- Define shared configuration for the AMM.
- Provide admin-gated updates and related events.
- Define execution-time state and events for trading.

## Usage

- Publish the package to initialize the admin capability.
- Call `create_amm_config_and_share` to create shared config and emit the creation event.
- Call `update_amm_config_and_emit` with an `AMMAdminCap` to change settings and emit the update event.