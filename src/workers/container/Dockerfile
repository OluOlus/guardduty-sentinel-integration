# Multi-stage build for GuardDuty to Sentinel Integration Container Worker
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install security updates and required packages
RUN apk update && apk upgrade && \
    apk add --no-cache \
    ca-certificates \
    curl \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S guardduty && \
    adduser -S guardduty -u 1001 -G guardduty

# Set working directory
WORKDIR /app

# Copy built application and dependencies
COPY --from=builder --chown=guardduty:guardduty /app/node_modules ./node_modules
COPY --from=builder --chown=guardduty:guardduty /app/dist ./dist
COPY --from=builder --chown=guardduty:guardduty /app/package*.json ./

# Create directories for logs and temp files
RUN mkdir -p /app/logs /app/tmp && \
    chown -R guardduty:guardduty /app

# Switch to non-root user
USER guardduty

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Set environment variables
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    LOG_LEVEL=info

# Start the application
CMD ["node", "dist/workers/container/index.js"]