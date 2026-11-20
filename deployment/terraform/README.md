# Terraform deployment

This directory contains a minimal AWS Terraform stack for Stellar Stream with separate staging and production workspaces.

## Layout

- `modules/vpc`: VPC, public/private subnets, NAT, routing
- `modules/ecs_backend`: ECS Fargate backend service behind an ALB
- `modules/frontend`: S3 static site behind CloudFront
- `modules/rds`: PostgreSQL RDS instance in private subnets

## Workspaces

Terraform workspaces are used to isolate staging and production:

```bash
cd deployment/terraform
terraform init
terraform workspace new staging
terraform workspace new production
terraform workspace select staging
terraform plan -var-file=env/staging.tfvars
terraform apply -var-file=env/staging.tfvars
```

## Secrets

Secrets are intentionally not stored in Terraform variables or state. Create the following values in AWS Secrets Manager before running Terraform:

- `stellar-stream/staging/jwt-secret`
- `stellar-stream/staging/admin-api-key`
- `stellar-stream/staging/webhook-signing-secret`
- `stellar-stream/production/jwt-secret`
- `stellar-stream/production/admin-api-key`
- `stellar-stream/production/webhook-signing-secret`

The RDS master password is managed by AWS RDS itself via `manage_master_user_password = true`, so no password is kept in state.

## Suggested variable files

Copy the example files into real environment files and replace the placeholders with your AWS values:

```bash
cp env/staging.tfvars.example env/staging.tfvars
cp env/production.tfvars.example env/production.tfvars
```

Then apply with the matching workspace.
