/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow the web app to proxy through the Node runtime for oracle + RPC calls.
  // No Edge-only limits.
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
