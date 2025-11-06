# Security Configuration Guide

## 🛡️ Security Layers

### 1. **API Key Authentication**

All admin endpoints require a valid API key.

**Setup:**

```bash
# Generate a secure API key
openssl rand -hex 32

# Add to your .env file
ADMIN_API_KEY=your_generated_api_key_here
```

**Usage:**

```bash
# Include API key in requests (either method works)
curl -H "X-API-Key: your_api_key" http://localhost:3002/admin/submit-game
curl -H "Authorization: Bearer your_api_key" http://localhost:3002/admin/submit-game
```

### 2. **Rate Limiting**

Prevents DoS attacks by limiting requests per IP.

**Configuration:**

```bash
# .env file
RATE_LIMIT_REQUESTS=100      # Max requests per window
RATE_LIMIT_WINDOW_MS=60000   # Window in milliseconds (60 seconds)
```

### 3. **IP Whitelisting** (Optional)

Restrict access to specific IP addresses.

**Configuration:**

```bash
# .env file - comma-separated list
ALLOWED_IPS=127.0.0.1,192.168.1.100,203.0.113.10

# To allow all IPs (default behavior)
# ALLOWED_IPS=
```

### 4. **Request Sanitization**

Automatically cleans malicious input (null bytes, XSS attempts).

### 5. **Security Headers**

- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block

## 🔐 Protected Endpoints

The following endpoints now require authentication:

- `POST /admin/submit-game`
- `POST /admin/toggle-scoring`
- `POST /admin/submit-rewards-results`
- `POST /admin/distribute-rewards`
- `POST /admin/distribute-leaderboard-rewards`

## 📋 Security Checklist

### ✅ **Essential (Do These First)**

- [ ] Set `ADMIN_API_KEY` in your `.env` file
- [ ] Use HTTPS in production (reverse proxy/load balancer)
- [ ] Set strong `PRIVATE_KEY` for blockchain operations
- [ ] Configure firewall to only allow necessary ports

### ✅ **Recommended**

- [ ] Configure `ALLOWED_IPS` for IP whitelisting
- [ ] Adjust rate limits based on your usage patterns
- [ ] Set up monitoring and logging
- [ ] Regular security audits

### ✅ **Production Hardening**

- [ ] Use environment-specific secrets management
- [ ] Implement Redis for distributed rate limiting
- [ ] Set up SSL/TLS certificates
- [ ] Configure reverse proxy (nginx/cloudflare)
- [ ] Enable fail2ban or similar intrusion prevention

## 🚨 Error Responses

### Unauthorized Access (401)

```json
{
  "error": "Unauthorized",
  "message": "Valid API key required for admin operations"
}
```

### Rate Limit Exceeded (429)

```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Limit: 100 requests per 60 seconds"
}
```

### IP Blocked (403)

```json
{
  "error": "Access denied",
  "message": "Your IP address is not authorized"
}
```

## 🛠️ Testing Security

### Test API Key Protection

```bash
# Should fail without API key
curl -X POST http://localhost:3002/admin/submit-game

# Should succeed with API key
curl -X POST -H "X-API-Key: your_key" http://localhost:3002/admin/submit-game
```

### Test Rate Limiting

```bash
# Send many requests quickly to trigger rate limit
for i in {1..150}; do curl http://localhost:3002/; done
```

### Check Security Status

```bash
# View security configuration
curl http://localhost:3002/
```

## 🔄 Additional Security Recommendations

### 1. **Environment Separation**

```bash
# Use different API keys for different environments
ADMIN_API_KEY_DEV=dev_key_here
ADMIN_API_KEY_PROD=prod_key_here
ADMIN_API_KEY_STAGING=staging_key_here
```

### 2. **Monitoring & Logging**

- Monitor failed authentication attempts
- Log all admin operations
- Set up alerts for suspicious activity

### 3. **Regular Security Updates**

- Keep dependencies updated: `npm audit`
- Review and rotate API keys regularly
- Monitor blockchain for unusual activity

### 4. **Smart Contract Security**

- Only the contract owner can call admin functions
- Funds are stored in the smart contract, not the server
- Consider multi-sig wallets for production

## 🚀 Production Deployment

For production, consider:

1. **Reverse Proxy Setup (nginx)**:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

2. **Environment Variables**:

```bash
# Use a secrets manager in production
export ADMIN_API_KEY=$(aws secretsmanager get-secret-value --secret-id prod/api-key --query SecretString --output text)
```

3. **Docker Security**:

```dockerfile
# Run as non-root user
USER node
EXPOSE 3002
```
