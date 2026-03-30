#!/bin/bash
export PATH="$(pwd)/.bin:$PATH"

echo "Starting Ivy Blackboard with mapped local CLI tools..."
./.bin/blackboard serve
