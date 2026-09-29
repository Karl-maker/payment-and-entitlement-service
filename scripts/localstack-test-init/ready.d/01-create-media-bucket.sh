#!/bin/sh
# LocalStack ready hook: ensure media bucket exists (matches eislett-education-api-learner test compose).
# Idempotent — mb may fail if the bucket already exists.
set -e
awslocal s3 mb "s3://media-test" 2>/dev/null || true
