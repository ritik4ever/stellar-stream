output "security_group_id" {
  value = aws_security_group.backend.id
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "backend_service_name" {
  value = aws_ecs_service.backend.name
}
