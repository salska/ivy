#!/bin/bash

# Tool 1: Read (read_file)
bun run dev work create \
  --id "test_read" \
  --title "Read the contents of package.json and report the project name and version" \
  --project "ivy-blackboard" \
  --priority "P2"

# Tool 2: Write (write_file)
bun run dev work create \
  --id "test_write" \
  --title "Create a new file called hello-world.txt in the root directory containing 'Hello from Gemini!'" \
  --project "ivy-blackboard" \
  --priority "P2"

# Tool 3: Glob (glob)
bun run dev work create \
  --id "test_glob" \
  --title "Find all markdown files (.md) in the src/ directory and list their paths" \
  --project "ivy-blackboard" \
  --priority "P2"

# Tool 4: LS (list_directory)
bun run dev work create \
  --id "test_ls" \
  --title "List the contents of the root directory and report how many folders there are" \
  --project "ivy-blackboard" \
  --priority "P2"

# Tool 5: GreP (grep_search)
bun run dev work create \
  --id "test_grep" \
  --title "Search for the word 'TODO' in all .ts files in the src/ directory and report the count" \
  --project "ivy-blackboard" \
  --priority "P2"

# Tool 6: Bash (run_shell_command)
bun run dev work create \
  --id "test_bash" \
  --title "Run 'echo "Testing Bash Tool"' and report the output" \
  --project "ivy-blackboard" \
  --priority "P2"

# Tool 7: WebFetch (web_fetch)
bun run dev work create \
  --id "test_webfetch" \
  --title "Fetch example.com and report the title of the webpage" \
  --project "ivy-blackboard" \
  --priority "P2"

# Tool 8: WebSearch (google_web_search)
bun run dev work create \
  --id "test_websearch" \
  --title "Search the web for the current status of Node.js 22 and report a brief summary" \
  --project "ivy-blackboard" \
  --priority "P2"

# Tool 9: Edit (replace)
# Note: We need a file to edit first, so we use the file created in test_write
bun run dev work create \
  --id "test_edit" \
  --title "Edit the hello-world.txt file to say 'Hello from Gemini! This file was edited.' instead of just 'Hello from Gemini!'" \
  --project "ivy-blackboard" \
  --priority "P2"

echo "Created 9 work items to test tools. Ensure the dispatch agent is running to process them."
