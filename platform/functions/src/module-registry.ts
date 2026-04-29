export interface PlatformModule {
  id: string;
  name: string;
  basePath: string;
  description: string;
}

export const platformModules: PlatformModule[] = [
  {
    id: "authn",
    name: "Authentication",
    basePath: "/authn",
    description: "Identity, credentials, JWT issuance, JWKS, and refresh tokens.",
  },
  {
    id: "authz",
    name: "Authorization",
    basePath: "/authz",
    description: "Roles, permissions, and materialized authz views.",
  },
  {
    id: "user",
    name: "User Profiles",
    basePath: "/user",
    description: "Profile data, preferences, metadata, and user search.",
  },
  {
    id: "group",
    name: "Groups",
    basePath: "/group",
    description: "Groups, memberships, and domain-based auto-assignment.",
  },
  {
    id: "building",
    name: "Buildings",
    basePath: "/building",
    description: "Building CRUD, scoped permissions, and building search.",
  },
];
