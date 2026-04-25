/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["yahoo-finance2"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = Array.isArray(config.externals)
        ? config.externals
        : config.externals
        ? [config.externals]
        : [];
      externals.push({ "yahoo-finance2": "commonjs yahoo-finance2" });
      config.externals = externals;
    }
    return config;
  },
};

module.exports = nextConfig;
