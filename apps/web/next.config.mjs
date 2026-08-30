const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@learnspace/db", "@learnspace/shared"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
