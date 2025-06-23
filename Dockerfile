# Use the official Playwright image with all dependencies
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Copy package files and install dependencies first for better caching
COPY package.json package-lock.json* ./
RUN npm install

# Copy the rest of the app
COPY . .

# Expose the port your app runs on (default 3000)
EXPOSE 3000

# Start the server
CMD ["node", "maze-api.js"]
