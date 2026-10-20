export type Role = 'admin' | 'editor' | 'member' | 'viewer';
export type LinkState = 'active' | 'disabled' | 'scheduled' | 'expired' | 'limit';
export type Color = 'slate' | 'crimson' | 'amber' | 'moss' | 'teal' | 'indigo' | 'plum' | 'rust';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  hasPassword: boolean;
  sso: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Session {
  user: User | null;
  setupRequired: boolean;
  oidc: { enabled: boolean; label: string };
  localLogin: boolean;
  version: string;
  organization: string;
  tessera: boolean;
  appUrl: string;
}

export interface Tag {
  id: number;
  name: string;
  color: Color;
  count?: number;
}
export interface Collection {
  id: number;
  name: string;
  color: Color;
  description?: string;
  count?: number;
}
export interface Utm {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}
export interface Campaign {
  id: number;
  name: string;
  color: Color;
  utm: Utm;
  startsAt: string | null;
  endsAt: string | null;
  description: string;
  archived: boolean;
  links: number;
  clicks: number;
}

export interface Rule {
  id: string;
  label: string;
  url: string;
  when: {
    platform?: ('ios' | 'android' | 'desktop' | 'other')[];
    language?: string[];
    weekdays?: number[];
    timeFrom?: string;
    timeTo?: string;
    dateFrom?: string;
    dateTo?: string;
  };
}
export interface Variant {
  id: string;
  label: string;
  url: string;
  weight: number;
}
export interface Routing {
  rules: Rule[];
  mainWeight: number;
  variants: Variant[];
}

export interface Link {
  id: number;
  domain: { id: number; host: string; kind: 'internal' | 'public'; status: string };
  slug: string;
  shortUrl: string;
  url: string;
  title: string;
  notes: string;
  redirectType: 301 | 302 | 307 | 308;
  effectiveRedirectType: 301 | 302 | 307 | 308;
  state: LinkState;
  enabled: boolean;
  archived: boolean;
  archivedAt: string | null;
  protected: boolean;
  owner: { id: number; name: string } | null;
  collection: { id: number; name: string; color: Color } | null;
  campaign: { id: number; name: string; color: Color } | null;
  tags: Tag[];
  favorite: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  maxClicks: number | null;
  fallbackUrl: string | null;
  hasPassword: boolean;
  forwardQuery: boolean;
  utm: Utm | null;
  routing: Routing | null;
  meta: { title: string | null; description: string | null; imageUrl: string | null; iconUrl: string | null; fetchedAt: string | null };
  health: { status: 'ok' | 'broken' | 'warning' | 'skipped' | null; code: number | null; detail: string | null; checkedAt: string | null };
  clicks: number;
  lastClickAt: string | null;
  spark: number[];
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export interface LinkList {
  total: number;
  items: Link[];
  limit: number;
  offset: number;
}

export interface Domain {
  id: number;
  host: string;
  baseUrl: string;
  kind: 'internal' | 'public';
  isDefault: boolean;
  status: 'pending' | 'active' | 'disabled';
  verifyToken: string;
  verifyMethod: string | null;
  verifiedAt: string | null;
  https: boolean;
  rootUrl: string | null;
  notFoundUrl: string | null;
  slugLength: number;
  permanentMaxAge: number;
  previewSuffix: boolean;
  note: string;
  lastCheckAt: string | null;
  lastCheck: CheckResult | null;
  createdAt: string;
  linkCount: number | null;
}

export interface CheckResult {
  at: string;
  ok: boolean;
  steps: { id: string; label: string; status: 'ok' | 'warning' | 'error' | 'skipped'; detail: string }[];
}

export interface StatsReport {
  range: { from: string; to: string; granularity: 'hour' | 'day' };
  mode: 'off' | 'basic' | 'extended';
  totals: { clicks: number; qr: number; bots: number; previous: number };
  series: { t: string; start: string; clicks: number; qr: number; bots: number }[];
  heatmap: number[][];
  dims: Record<string, { value: string; count: number }[]>;
  top: { id: number; slug: string; host: string; title: string; url: string; clicks: number; previous: number }[];
}

export interface Settings {
  analyticsMode: 'off' | 'basic' | 'extended';
  retentionDays: number;
  detailRetentionDays: number;
  trackUnknownSlugs: boolean;
  timezone: string;
  allowedSchemes: string[];
  blockedHosts: string[];
  defaultRedirectType: 301 | 302 | 307 | 308;
  slugStyle: 'random' | 'readable';
  fetchPreviews: boolean;
  healthChecks: boolean;
  reportsEnabled: boolean;
  memberCanCreateTags: boolean;
  organizationName: string;
}

export interface Counts {
  live: number;
  active: number;
  disabled: number;
  scheduled: number;
  expired: number;
  archived: number;
  favorites: number;
  mine: number;
  broken: number;
  protected: number;
}

export interface Preset {
  id: number;
  name: string;
  settings: {
    domainId?: number;
    redirectType?: 301 | 302 | 307 | 308;
    tags?: string[];
    collectionId?: number | null;
    campaignId?: number | null;
    expiresInDays?: number | null;
    forwardQuery?: boolean;
    protected?: boolean;
    slugStyle?: 'random' | 'readable';
  };
}
