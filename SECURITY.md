# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in KimDB, please email security@example.com with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

**Please do not open public issues for security vulnerabilities.**

We will acknowledge your report within 48 hours and work with you to verify and fix the issue.

## Security Best Practices

When using KimDB in production:

### 1. Database Security
- Use strong authentication credentials
- Enable SSL/TLS for WebSocket connections
- Store data in encrypted volumes
- Regular backups to secure locations

### 2. Network Security
- Run KimDB behind a reverse proxy (Nginx, Apache)
- Use firewall rules to restrict access
- Enable CORS only for trusted origins
- Use environment variables for sensitive config

### 3. Dependency Management
- Keep Node.js and npm updated
- Run `npm audit` regularly
- Use Dependabot for automated updates
- Review dependency vulnerabilities

### 4. Access Control
- Implement authentication at application level
- Use principle of least privilege
- Rotate API keys regularly
- Monitor access logs

### 5. Performance & DoS Prevention
- Implement rate limiting
- Monitor memory usage
- Set query timeouts
- Use connection pooling

## Supported Versions

| Version | Status | Support Until |
|---------|--------|---------------|
| 7.6.x | Stable | 2027-02-13 |
| 7.5.x | LTS | 2026-08-13 |
| < 7.5.0 | EOL | Not supported |

## Security Updates

Critical security patches will be released ASAP. We recommend:

- Subscribe to GitHub release notifications
- Monitor the CHANGELOG for security updates
- Test updates in staging before production
- Update promptly after security releases

## Third-Party Audits

KimDB has been reviewed for security concerns. No critical vulnerabilities have been reported.

For detailed security information, see our documentation at: https://github.com/kim/kimdb/docs/security

## Acknowledgments

We thank the security research community for helping keep KimDB secure.
