# Deployment Guide - LuminaryTrade

## Kubernetes Architecture

The LuminaryTrade backend is deployed as a high-availability cluster within Kubernetes.

### Manifests Structure
- `k8s/base/`: Core resource definitions (Deployment, Service, Ingress)
- `k8s/overlays/prod/`: Production-specific configuration and resource limits

## Deployment Steps

1. **Build Docker Image**
   ```bash
   docker build -t luminarytrade/backend:latest .
   ```

2. **Setup Secrets**
   Ensure Vault is configured and accessible.
   Alternatively, create a Kubernetes secret:
   ```bash
   kubectl create secret generic backend-secrets --from-env-file=.env.prod
   ```

3. **Apply Manifests**
   ```bash
   kubectl apply -k k8s/overlays/production
   ```

## Monitoring & Observability

- **Jaeger**: For distributed tracing
- **ELK Stack**: For log aggregation
- **Prometheus/Grafana**: For metrics monitoring

## Secret Management

Secrets are managed via HashiCorp Vault. The app fetches and caches secrets at startup and periodic intervals (30s) to handle rotation.
