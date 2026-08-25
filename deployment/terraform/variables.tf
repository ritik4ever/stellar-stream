variable "project_name" {
  description = "Project name used in AWS resource names."
  type        = string
  default     = "stellar-stream"
}

variable "aws_region" {
  description = "AWS region where the stack is deployed."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment, typically staging or production."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be either staging or production."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets."
  type        = list(string)
  default     = ["10.20.1.0/24", "10.20.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets used by RDS and ECS tasks."
  type        = list(string)
  default     = ["10.20.11.0/24", "10.20.12.0/24"]
}

variable "frontend_bucket_name" {
  description = "Globally unique S3 bucket name for the static frontend."
  type        = string

  validation {
    condition     = length(var.frontend_bucket_name) > 0
    error_message = "frontend_bucket_name must not be empty."
  }
}

variable "backend_image" {
  description = "Backend container image reference, for example an ECR repository URI."
  type        = string
  default     = "public.ecr.aws/docker/library/nginx:latest"
}

variable "backend_cpu" {
  description = "CPU units for the backend ECS task."
  type        = number
  default     = 512
}

variable "backend_memory" {
  description = "Memory in MiB for the backend ECS task."
  type        = number
  default     = 1024
}

variable "backend_desired_count" {
  description = "Desired count of backend tasks in ECS."
  type        = number
  default     = 2
}

variable "db_name" {
  description = "Initial database name for PostgreSQL."
  type        = string
  default     = "stellar_stream"
}

variable "db_username" {
  description = "Master database username for PostgreSQL."
  type        = string
  default     = "stellarstream"
}

variable "db_instance_class" {
  description = "AWS RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Storage size in GB for the PostgreSQL instance."
  type        = number
  default     = 20
}

variable "db_backup_retention_days" {
  description = "Backup retention period in days for RDS."
  type        = number
  default     = 7
}

variable "jwt_secret_arn" {
  description = "ARN of the JWT secret stored in AWS Secrets Manager."
  type        = string
}

variable "admin_api_key_arn" {
  description = "ARN of the admin API key secret stored in AWS Secrets Manager."
  type        = string
}

variable "webhook_signing_secret_arn" {
  description = "ARN of the webhook signing secret stored in AWS Secrets Manager."
  type        = string
}

variable "allowed_origins" {
  description = "List of allowed CORS origins for the backend."
  type        = list(string)
  default     = ["https://example.com"]
}
