import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";

// The SDK app facade reads the host runtime once, when it is first imported.
// Tests that import components statically need the runtime installed before
// that; bb's built-in copy never hit this because shared-ui's Icon was local.
installTestPluginRuntime();
