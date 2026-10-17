# Student Result Management System

Serverless AWS app (API Gateway + Lambda + DynamoDB) with a static frontend,
now containerised with Docker and built by Jenkins.

```
student-result-system/
├── backend/    lambda_function.py, Dockerfile (Lambda container image), tests/
├── frontend/   index.html, script.js, style.css, Dockerfile (nginx)
├── docker-compose.yml
└── Jenkinsfile
```

## Run locally
```bash
docker compose up --build
docker compose run --rm init-table      # only if the table wasn't created
# Frontend -> http://localhost:8080
# Test the Lambda directly:
curl -s -XPOST http://localhost:9000/2015-03-31/functions/function/invocations \
  -d '{"routeKey":"GET /stats","headers":{"x-admin-passcode":"local-passcode"}}'
```
The browser frontend calls your real API Gateway URL (set `API_BASE_URL` when building:
`API_BASE_URL=https://... docker compose up --build`). The Lambda emulator speaks Lambda
events, not HTTP, so it is for curl/smoke tests only.

## Run tests
```bash
cd backend && pip install -r requirements-dev.txt && pytest
```

## One-time AWS setup for the pipeline
1. Create ECR repos: `student-result-backend`, `student-result-frontend`.
2. Create a **new** Lambda function from the container image (an existing zip-based
   function can't be switched to an image). Set env vars `ADMIN_PASSCODE`, `TABLE_NAME`,
   attach the same IAM role, and point the API Gateway integration at it.
3. In Jenkins: install *Docker Pipeline* and *CloudBees AWS Credentials* plugins, add an
   `aws-credentials` credential, make sure the `jenkins` user can run `docker`, and install AWS CLI.
4. Edit `AWS_ACCOUNT_ID`, `LAMBDA_FUNCTION`, `API_BASE_URL` at the top of the `Jenkinsfile`.
5. Create a Pipeline job from SCM pointing to this repo. Tick **DEPLOY** to push and deploy.

IAM permissions the Jenkins user needs: `ecr:GetAuthorizationToken`, ECR push actions on both repos,
`lambda:UpdateFunctionCode`, `lambda:GetFunction`.
