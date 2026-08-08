/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server Actions are not used; all mutations go through route handlers so
    // the worker service can call the same endpoints.
  },
};

export default nextConfig;
