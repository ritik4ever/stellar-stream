data "aws_caller_identity" "current" {}

locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

module "vpc" {
  source = "./modules/vpc"

  project_name          = var.project_name
  environment           = var.environment
  vpc_cidr              = var.vpc_cidr
  public_subnet_cidrs   = var.public_subnet_cidrs
  private_subnet_cidrs  = var.private_subnet_cidrs
  availability_zones    = ["${var.aws_region}a", "${var.aws_region}b"]
}

module "rds" {
  source = "./modules/rds"

  project_name             = var.project_name
  environment              = var.environment
  db_name                  = var.db_name
  db_username              = var.db_username
  db_instance_class        = var.db_instance_class
  db_allocated_storage     = var.db_allocated_storage
  db_backup_retention_days = var.db_backup_retention_days
  subnet_ids               = module.vpc.private_subnet_ids
  vpc_id                   = module.vpc.vpc_id
  vpc_cidr                 = var.vpc_cidr
}

module "backend" {
  source = "./modules/ecs_backend"

  project_name              = var.project_name
  environment               = var.environment
  vpc_id                    = module.vpc.vpc_id
  public_subnet_ids         = module.vpc.public_subnet_ids
  private_subnet_ids        = module.vpc.private_subnet_ids
  backend_image             = var.backend_image
  backend_cpu               = var.backend_cpu
  backend_memory            = var.backend_memory
  backend_desired_count     = var.backend_desired_count
  aws_region                = var.aws_region
  db_host                   = module.rds.db_host
  db_port                   = module.rds.db_port
  db_name                   = module.rds.db_name
  db_user                   = module.rds.db_user
  jwt_secret_arn            = var.jwt_secret_arn
  admin_api_key_arn         = var.admin_api_key_arn
  webhook_signing_secret_arn = var.webhook_signing_secret_arn
  allowed_origins           = var.allowed_origins
}

module "frontend" {
  source = "./modules/frontend"

  project_name         = var.project_name
  environment          = var.environment
  bucket_name          = var.frontend_bucket_name
}
