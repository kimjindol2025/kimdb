# KimDB Authentication Guide

Complete guide to implementing authentication and authorization in KimDB.

## 📋 Overview

KimDB supports multiple authentication methods:
1. **JWT (JSON Web Token)** - Stateless, scalable
2. **API Keys** - Simple key-based authentication
3. **OAuth 2.0** - Third-party integration (optional)
4. **Custom Authentication** - Implement your own logic

---

## JWT (Recommended)

### How JWT Works

1. Client sends credentials to auth server
2. Server validates and issues JWT token
3. Client includes token in `Authorization` header
4. Server validates token on each request

### Token Structure

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.
eyJzdWIiOiJ1c2VyLTAwMSIsImlhdCI6MTcwNTMxNzAwMCwiZXhwIjoxNzA1NDAzNDAwfQ.
signature...

[Header].[Payload].[Signature]
```

### Token Payload

```json
{
  "sub": "user-001",           // Subject (user ID)
  "iat": 1705317000,           // Issued at (Unix timestamp)
  "exp": 1705403400,           // Expiration (24 hours)
  "role": "admin",             // User role
  "permissions": ["read", "write"]  // Scopes
}
```

### Generating JWT

**Server-side (Node.js):**

```javascript
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;  // Minimum 64 characters

function generateToken(userId, role = 'user') {
  const payload = {
    sub: userId,
    role: role,
    permissions: getPermissions(role),
    iat: Math.floor(Date.now() / 1000),
  };

  const options = {
    expiresIn: '24h'  // Token valid for 24 hours
  };

  return jwt.sign(payload, SECRET, options);
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (error) {
    throw new Error(`Invalid token: ${error.message}`);
  }
}
```

### Using JWT in Requests

**Request with Authorization header:**

```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  http://localhost:40000/api/c/users
```

**JavaScript:**

```javascript
const token = generateToken('user-001', 'admin');

fetch('http://localhost:40000/api/c/users', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
.then(response => response.json())
.then(data => console.log(data));
```

**Python:**

```python
import requests

token = generate_token('user-001', 'admin')

headers = {
    'Authorization': f'Bearer {token}'
}

response = requests.get(
    'http://localhost:40000/api/c/users',
    headers=headers
)
print(response.json())
```

### Token Refresh

Implement token refresh for better security:

```javascript
function generateTokens(userId) {
  const accessToken = jwt.sign(
    { sub: userId },
    ACCESS_SECRET,
    { expiresIn: '15m' }  // Short-lived
  );

  const refreshToken = jwt.sign(
    { sub: userId },
    REFRESH_SECRET,
    { expiresIn: '7d' }   // Long-lived
  );

  return { accessToken, refreshToken };
}

function refreshAccessToken(refreshToken) {
  try {
    const payload = jwt.verify(refreshToken, REFRESH_SECRET);
    return jwt.sign(
      { sub: payload.sub },
      ACCESS_SECRET,
      { expiresIn: '15m' }
    );
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
}
```

---

## API Keys

### Generating API Keys

**Server-side:**

```javascript
import crypto from 'crypto';

function generateApiKey() {
  // Generate 64-character hex string
  return crypto.randomBytes(32).toString('hex');
}

function hashApiKey(apiKey) {
  return crypto
    .createHash('sha256')
    .update(apiKey)
    .digest('hex');
}

// Store hashed key in database
const apiKey = generateApiKey();
const hashedKey = hashApiKey(apiKey);
db.insertApiKey(userId, hashedKey);

console.log(`API Key: ${apiKey}`);  // Share with user once
```

### Using API Keys

**Request with API Key header:**

```bash
curl -H "X-API-Key: your-api-key-here" \
  http://localhost:40000/api/c/users
```

**JavaScript:**

```javascript
fetch('http://localhost:40000/api/c/users', {
  headers: {
    'X-API-Key': 'your-api-key-here'
  }
})
.then(response => response.json())
.then(data => console.log(data));
```

### Validating API Keys

**Server-side:**

```javascript
function validateApiKey(providedKey) {
  const hashedKey = hashApiKey(providedKey);
  const storedKey = db.getApiKey(hashedKey);

  if (!storedKey) {
    throw new Error('Invalid API key');
  }

  return storedKey.userId;
}
```

---

## Role-Based Access Control (RBAC)

### Define Roles and Permissions

```javascript
const ROLES = {
  admin: {
    permissions: ['read', 'write', 'delete', 'admin'],
  },
  editor: {
    permissions: ['read', 'write'],
  },
  viewer: {
    permissions: ['read'],
  },
  guest: {
    permissions: [],
  },
};

function getPermissions(role) {
  return ROLES[role]?.permissions || [];
}
```

### Middleware for Permission Checking

```javascript
function requirePermission(requiredPermission) {
  return async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return reply.code(401).send({ error: 'No token provided' });
    }

    try {
      const payload = verifyToken(token);
      const permissions = getPermissions(payload.role);

      if (!permissions.includes(requiredPermission)) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      req.userId = payload.sub;
      req.role = payload.role;
    } catch (error) {
      return reply.code(401).send({ error: 'Invalid token' });
    }
  };
}

// Usage
fastify.get('/api/admin/users',
  { preHandler: requirePermission('admin') },
  async (req) => {
    // Only users with 'admin' permission can access
  }
);
```

---

## OAuth 2.0 (Optional)

### Google OAuth 2.0 Integration

```javascript
import GoogleStrategy from 'passport-google-oauth20';

passport.use(new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: 'http://localhost:40000/auth/google/callback'
  },
  (accessToken, refreshToken, profile, done) => {
    const user = {
      id: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName,
      picture: profile.photos[0].value,
      role: 'user'
    };

    // Find or create user
    db.findOrCreateUser(user);
    return done(null, user);
  }
));

// Routes
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    const token = generateToken(req.user.id);
    res.redirect(`/dashboard?token=${token}`);
  }
);
```

---

## Security Best Practices

### 1. Secret Management

```javascript
// ✅ Good: Environment variables
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 64) {
  throw new Error('JWT_SECRET must be at least 64 characters');
}

// ❌ Bad: Hardcoded secrets
const JWT_SECRET = 'my-secret';  // Too short!
```

### 2. HTTPS Only

```javascript
// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}
```

### 3. Token Expiration

```javascript
// Set reasonable expiration times
const ACCESS_TOKEN_EXPIRY = '15m';   // Short-lived
const REFRESH_TOKEN_EXPIRY = '7d';   // Longer-lived
const API_KEY_EXPIRY = '90d';        // Auto-rotate
```

### 4. Rate Limiting

```javascript
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                     // 5 attempts
  message: 'Too many login attempts'
});

app.post('/auth/login', loginLimiter, (req, res) => {
  // ...
});
```

### 5. CORS Configuration

```javascript
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

### 6. Token Validation

```javascript
function validateToken(token) {
  // Check format
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  // Verify signature
  try {
    const decoded = jwt.verify(token, SECRET);

    // Check expiration
    if (decoded.exp < Date.now() / 1000) {
      throw new Error('Token expired');
    }

    return decoded;
  } catch (error) {
    throw new Error(`Token validation failed: ${error.message}`);
  }
}
```

---

## Common Patterns

### Login Flow

```javascript
// 1. Client submits credentials
POST /auth/login
{
  "email": "user@example.com",
  "password": "password123"
}

// 2. Server validates and returns tokens
{
  "success": true,
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 900
}

// 3. Client stores tokens
localStorage.setItem('accessToken', response.accessToken);
localStorage.setItem('refreshToken', response.refreshToken);

// 4. Client uses accessToken in requests
headers['Authorization'] = `Bearer ${accessToken}`;
```

### Logout Flow

```javascript
POST /auth/logout
{
  "refreshToken": "eyJ..."
}

// Server invalidates token
// Client clears localStorage
localStorage.removeItem('accessToken');
localStorage.removeItem('refreshToken');
```

### Token Refresh Flow

```javascript
// When access token expires:
POST /auth/refresh
{
  "refreshToken": "eyJ..."
}

// Response
{
  "accessToken": "new-token...",
  "expiresIn": 900
}

// Client updates token
localStorage.setItem('accessToken', response.accessToken);
```

---

## Implementation Checklist

- [ ] Generate strong JWT_SECRET (64+ characters)
- [ ] Configure HTTPS in production
- [ ] Implement token expiration
- [ ] Add rate limiting on auth endpoints
- [ ] Hash API keys before storage
- [ ] Implement RBAC for sensitive operations
- [ ] Add token refresh mechanism
- [ ] Setup CORS properly
- [ ] Validate tokens on every protected endpoint
- [ ] Monitor failed auth attempts
- [ ] Regular security audits

---

## Troubleshooting

### "Invalid token" Error

```javascript
// Check 1: Token format
const token = req.headers.authorization?.replace('Bearer ', '');
if (!token) {
  throw new Error('No token provided');
}

// Check 2: Token expiration
const decoded = jwt.decode(token);
if (decoded.exp < Date.now() / 1000) {
  throw new Error('Token expired');
}

// Check 3: Secret mismatch
if (process.env.JWT_SECRET !== storedSecret) {
  throw new Error('Secret mismatch');
}
```

### "Insufficient Permissions" Error

```javascript
// Check 1: Role in token
const payload = jwt.verify(token, SECRET);
console.log('User role:', payload.role);

// Check 2: Permissions mapping
console.log('Required:', requiredPermission);
console.log('Available:', getPermissions(payload.role));

// Check 3: RBAC configuration
console.log('ROLES config:', ROLES);
```

---

## See Also

- [API Reference](./API.md) - Full API documentation
- [SECURITY.md](../SECURITY.md) - Security policies
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Development guide

---

Last updated: 2024-02-13
Version: 7.6.1
