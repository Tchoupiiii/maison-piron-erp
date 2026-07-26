import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pas de pastille Next.js en surimpression : l'écran est celui de la boutique.
  devIndicators: false,

  experimental: {
    serverActions: {
      // Le corps d'une Server Action est plafonné à 1 Mo par défaut : un scan de
      // certificat de labo serait refusé avant même d'atteindre le contrôle des
      // 15 Mo. La marge couvre l'habillage multipart.
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
