#!/bin/bash
echo "Weekly load test (Closes #426)"
npx autocannon http://localhost:3001/api/streams -c 20 -d 30
