resource "aws_db_subnet_group" "this" {
  name       = "${var.project_name}-${var.environment}-db-subnets"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "${var.project_name}-${var.environment}-db-subnets"
  }
}

resource "aws_security_group" "db" {
  name        = "${var.project_name}-${var.environment}-db-sg"
  description = "Allow PostgreSQL from within the VPC"
  vpc_id      = var.vpc_id

  ingress {
    description = "PostgreSQL from the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-db-sg"
  }
}

resource "aws_db_instance" "this" {
  identifier                          = "${var.project_name}-${var.environment}-db"
  db_name                             = var.db_name
  username                            = var.db_username
  manage_master_user_password         = true
  instance_class                      = var.db_instance_class
  allocated_storage                   = var.db_allocated_storage
  engine                              = "postgres"
  engine_version                      = "16.3"
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [aws_security_group.db.id]
  publicly_accessible                 = false
  skip_final_snapshot                 = true
  backup_retention_period             = var.db_backup_retention_days
  auto_minor_version_upgrade          = true
  deletion_protection                 = false
  performance_insights_enabled        = true
  storage_encrypted                   = true
  enabled_cloudwatch_logs_exports     = ["postgresql", "upgrade"]

  tags = {
    Name = "${var.project_name}-${var.environment}-db"
  }
}
