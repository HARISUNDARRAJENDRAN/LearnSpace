const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@learnspace/db", "@learnspace/shared"],
  webpack(config) {
    config.resolve.extensions = [
      ".ts",
      ".tsx",
      ...config.resolve.extensions.filter((extension) => extension !== ".ts" && extension !== ".tsx"),
    ];
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
