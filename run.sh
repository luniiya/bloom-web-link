#!/bin/sh
set -eu

# Keep the familiar entry point while running the complete container stack.
exec make up
