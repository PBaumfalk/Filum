import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ArrowDownUp,
  ChevronDown,
  CircleOff,
  Copy,
  Download,
  Filter,
  Folder,
  FolderInput,
  Globe,
  Lock,
  Megaphone,
  MoreHorizontal,
  Play,
  Scissors,
  Search,
  ShieldCheck,
  ShieldOff,
  Star,
  StarOff,
  Tag as TagIcon,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router';
import { Composer } from '../components/Composer';
import { Inspector } from '../components/Inspector';
import { MenuItem, Popover } from '../components/overlay';
import { useToast } from '../components/toast';
import { copyText, Empty, ShortLabel, Skeleton, Spark, StateBadge, TagChip } from '../components/ui';
import { api, qs } from '../lib/api';
import { compact, num, relative, splitUrl } from '../lib/format';
import { can, useCampaigns, useCollections, useDomains, useInvalidateLinks, useSession, useTags } from '../lib/queries';
import { useDocumentTitle } from '../lib/title';
import type { Link, LinkList } from '../lib/types';

const PAGE = 50;

const STATES = [
  { value: '', label: 'Alle in Betrieb' },
  { value: 'active', label: 'Aktiv' },
  { value: 'scheduled', label: 'Geplant' },
  { value: 'expired', label: 'Abgelaufen' },
  { value: 'disabled', label: 'Deaktiviert' },
  { value: 'archived', label: 'Archiviert' },
  { value: 'all', label: 'Alles inklusive Archiv' },
];

const SORTS = [
  { value: 'created', label: 'Neueste zuerst' },
  { value: 'updated', label: 'Zuletzt geändert' },
  { value: 'clicks', label: 'Meiste Aufrufe' },
  { value: 'last_click', label: 'Zuletzt aufgerufen' },
  { value: 'slug', label: 'Kurzadresse A–Z' },
  { value: 'expires', label: 'Läuft bald ab' },
];

export function LinksPage() {
  const { id } = useParams();
  const selectedId = id ? Number(id) : null;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const session = useSession();
  const role = session.data?.user?.role;
  const toast = useToast();
  const invalidate = useInvalidateLinks();
  const domains = useDomains();
  const tags = useTags();
  const collections = useCollections();
  const campaigns = useCampaigns();

  const [search, setSearch] = useState(params.get('q') ?? '');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [focusIdx, setFocusIdx] = useState(-1);
  const [fresh, setFresh] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const page = Number(params.get('page') ?? '1') || 1;
  const filters = {
    q: params.get('q') ?? '',
    state: params.get('state') ?? '',
    tag: params.get('tag') ?? '',
    collectionId: params.get('collectionId') ?? '',
    campaignId: params.get('campaignId') ?? '',
    domainId: params.get('domainId') ?? '',
    owner: params.get('owner') ?? '',
    favorite: params.get('favorite') ?? '',
    health: params.get('health') ?? '',
    protected: params.get('protected') ?? '',
    sort: params.get('sort') ?? 'created',
    dir: params.get('dir') ?? '',
  };

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      if (!('page' in patch)) next.delete('page');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) setParam({ q: search.trim() || null });
    }, 220);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => setSearch(params.get('q') ?? ''), [params]);

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener('filum:search', focus);
    return () => window.removeEventListener('filum:search', focus);
  }, []);

  const query = qs({
    q: filters.q,
    state: filters.state || undefined,
    tag: filters.tag,
    collectionId: filters.collectionId,
    campaignId: filters.campaignId,
    domainId: filters.domainId,
    owner: filters.owner,
    favorite: filters.favorite,
    health: filters.health,
    protected: filters.protected,
    sort: filters.sort,
    dir: filters.dir || (filters.sort === 'slug' || filters.sort === 'expires' ? 'asc' : 'desc'),
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });

  const links = useQuery({
    queryKey: ['links', query],
    queryFn: () => api.get<LinkList>(`/api/v1/links${query}`),
    placeholderData: keepPreviousData,
  });
  const items = links.data?.items ?? [];

  useEffect(() => setChecked(new Set()), [query]);

  // Tastatur: j/k bewegen, Enter öffnet, c kopiert, x markiert
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role="dialog"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!items.length) return;
      const cur = focusIdx >= 0 ? focusIdx : Math.max(items.findIndex((l) => l.id === selectedId), -1);
      if (e.key === 'j' || e.key === 'ArrowDown') {
        if (e.key === 'ArrowDown' && document.activeElement?.closest('.inspector')) return;
        e.preventDefault();
        setFocusIdx(Math.min(cur + 1, items.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        if (e.key === 'ArrowUp' && document.activeElement?.closest('.inspector')) return;
        e.preventDefault();
        setFocusIdx(Math.max(cur - 1, 0));
      } else if (e.key === 'Enter' && cur >= 0 && !document.activeElement?.closest('button, a')) {
        navigate(`/links/${items[cur].id}${window.location.search}`);
      } else if (e.key === 'c' && cur >= 0) {
        void copyText(items[cur].shortUrl).then((ok) => ok && toast.ok(`${items[cur].domain.host}/${items[cur].slug} kopiert`));
      } else if ((e.key === 'x' || e.key === 'X') && cur >= 0) {
        toggle(items[cur].id, e.shiftKey);
      } else if (e.key === 'Escape' && selectedId) {
        navigate(`/${window.location.search}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, focusIdx, selectedId]);

  useEffect(() => {
    if (focusIdx < 0) return;
    const el = listRef.current?.querySelectorAll<HTMLElement>('.link-row')[focusIdx];
    el?.focus();
  }, [focusIdx]);

  // Ankerzeile für Shift-Klick: markiert bzw. entmarkiert den ganzen Bereich wie die angeklickte Zeile.
  const anchorRef = useRef<number | null>(null);
  const toggle = (linkId: number, range = false) => {
    const idx = items.findIndex((l) => l.id === linkId);
    const anchor = anchorRef.current !== null ? items.findIndex((l) => l.id === anchorRef.current) : -1;
    setChecked((s) => {
      const n = new Set(s);
      const on = !n.has(linkId);
      if (range && anchor >= 0 && idx >= 0) {
        for (let i = Math.min(anchor, idx); i <= Math.max(anchor, idx); i++) {
          if (on) n.add(items[i].id);
          else n.delete(items[i].id);
        }
      } else if (on) n.add(linkId);
      else n.delete(linkId);
      return n;
    });
    anchorRef.current = linkId;
  };

  // Fokus nach dem Schließen des Inspectors zurück auf die Zeile, von der aus er geöffnet wurde.
  const openedRef = useRef<number | null>(null);
  useEffect(() => {
    if (selectedId) {
      openedRef.current = selectedId;
      return;
    }
    const back = openedRef.current;
    openedRef.current = null;
    if (back === null) return;
    const raf = window.requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body && !document.activeElement.closest('.inspector')) return;
      const el = listRef.current?.querySelector<HTMLElement>(`.link-row[data-link-id="${back}"]`);
      if (!el) return;
      el.focus({ preventScroll: false });
      el.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [selectedId]);

  const singleDomain = (domains.data?.items.length ?? 0) <= 1;
  // Slug für den Fenstertitel: aus der Liste oder – wenn der Link nicht auf dieser Seite steht – aus dem Inspector-Cache.
  const openLink = useQuery({ queryKey: ['link', selectedId], queryFn: () => api.get<Link>(`/api/v1/links/${selectedId}`), enabled: false });
  const openSlug = selectedId ? (items.find((l) => l.id === selectedId)?.slug ?? openLink.data?.slug) : null;
  useDocumentTitle(openSlug, 'Links');

  const allChecked = items.length > 0 && items.every((l) => checked.has(l.id));

  const activeFilters: { key: string; label: string }[] = [];
  if (filters.tag) activeFilters.push({ key: 'tag', label: `Schlagwort: ${filters.tag}` });
  if (filters.collectionId)
    activeFilters.push({ key: 'collectionId', label: `Sammlung: ${filters.collectionId === 'none' ? 'ohne' : collections.data?.items.find((c) => String(c.id) === filters.collectionId)?.name ?? '…'}` });
  if (filters.campaignId)
    activeFilters.push({ key: 'campaignId', label: `Kampagne: ${filters.campaignId === 'none' ? 'ohne' : campaigns.data?.items.find((c) => String(c.id) === filters.campaignId)?.name ?? '…'}` });
  if (filters.domainId) activeFilters.push({ key: 'domainId', label: `Domain: ${domains.data?.items.find((d) => String(d.id) === filters.domainId)?.host ?? '…'}` });
  if (filters.owner) activeFilters.push({ key: 'owner', label: 'Meine Links' });
  if (filters.favorite) activeFilters.push({ key: 'favorite', label: 'Favoriten' });
  if (filters.health) activeFilters.push({ key: 'health', label: filters.health === 'broken' ? 'Ziel gestört' : `Zielprüfung: ${filters.health}` });
  if (filters.protected) activeFilters.push({ key: 'protected', label: 'Verteilt & geschützt' });

  const heading = filters.favorite
    ? 'Favoriten'
    : filters.owner
      ? 'Meine Links'
      : filters.health === 'broken'
        ? 'Ziel gestört'
        : filters.protected
          ? 'Verteilt & geschützt'
          : filters.collectionId && filters.collectionId !== 'none'
            ? (collections.data?.items.find((c) => String(c.id) === filters.collectionId)?.name ?? 'Sammlung')
            : filters.tag
              ? `#${filters.tag}`
              : 'Links';

  const total = links.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const canCreate = can(role, 'member');

  return (
    <div className={selectedId ? 'has-inspector' : undefined} style={{ display: 'contents' }}>
      <div className="page">
        <div className="page-inner">
          {canCreate && !filters.favorite && !filters.owner && !filters.health && !filters.protected && (
            <div style={{ marginBottom: 6 }}>
              <Composer
                onCreated={(l) => {
                  setFresh(l.id);
                  window.setTimeout(() => setFresh(null), 2600);
                }}
              />
            </div>
          )}

          <div className="toolbar">
            <h1 style={{ fontSize: 'var(--fs-xl)', marginRight: 8 }}>{heading}</h1>
            <span className="muted small num">{links.data ? num(total) : ''}</span>
            <span className="spacer" />
            <div className="search">
              <Search aria-hidden />
              <input
                ref={searchRef}
                className="input"
                placeholder="Suchen"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearch('');
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setFocusIdx(0);
                  }
                }}
                aria-label="Links durchsuchen"
                type="search"
              />
              {!search && <span className="kbd">/</span>}
            </div>
          </div>

          <div className="row wrap" style={{ marginBottom: 12, gap: 6 }}>
            <SelectChip
              icon={<CircleOff />}
              label={STATES.find((s) => s.value === filters.state)?.label ?? 'Status'}
              options={STATES}
              value={filters.state}
              onChange={(v) => setParam({ state: v || null })}
              pressed={Boolean(filters.state)}
            />
            <FilterMenu
              onPick={setParam}
              tags={tags.data?.items ?? []}
              collections={collections.data?.items ?? []}
              campaigns={campaigns.data?.items ?? []}
              domains={domains.data?.items ?? []}
            />
            {activeFilters.map((f) => (
              <button key={f.key} className="filter-chip" aria-pressed="true" onClick={() => setParam({ [f.key]: null })} aria-label={`Filter ${f.label} entfernen`}>
                {f.label}
                <X />
              </button>
            ))}
            <span className="spacer" />
            <SelectChip icon={<ArrowDownUp />} label={SORTS.find((s) => s.value === filters.sort)?.label ?? 'Sortierung'} options={SORTS} value={filters.sort} onChange={(v) => setParam({ sort: v, dir: null })} align="end" />
            <ExportMenu query={query} />
          </div>

          <div className="list" ref={listRef} role="listbox" aria-label="Links" aria-multiselectable="true">
            <div className="list-head" role="presentation">
              <span>
                {items.length > 0 && (
                  <input
                    type="checkbox"
                    className="check"
                    checked={allChecked}
                    onChange={() => setChecked(allChecked ? new Set() : new Set(items.map((l) => l.id)))}
                    aria-label="Alle auf dieser Seite auswählen"
                    style={{ accentColor: 'var(--thread)', marginLeft: 9 }}
                  />
                )}
              </span>
              <span>Kurzlink und Ziel</span>
              <span style={{ textAlign: 'right' }}>Aufrufe · 14 Tage</span>
              <span>Status</span>
              <span />
            </div>
            {links.isLoading &&
              Array.from({ length: 6 }, (_, i) => (
                <div className="link-row" key={i} aria-hidden>
                  <Skeleton w={34} h={34} />
                  <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                    <Skeleton w="45%" />
                    <Skeleton w="70%" h={11} />
                  </div>
                  <Skeleton w={60} />
                  <Skeleton w={60} />
                  <span />
                </div>
              ))}
            {!links.isLoading && items.length === 0 && (
              <EmptyState
                filtered={Boolean(filters.q || activeFilters.length || filters.state)}
                query={filters.q}
                otherFilters={Boolean(activeFilters.length || filters.state)}
                onClearSearch={() => {
                  setSearch('');
                  setParam({ q: null });
                  searchRef.current?.focus();
                }}
                canCreate={canCreate}
              />
            )}
            {items.map((l, i) => (
              <LinkRow
                key={l.id}
                link={l}
                selected={l.id === selectedId}
                fresh={l.id === fresh}
                checked={checked.has(l.id)}
                hostMode={singleDomain ? 'quiet' : 'show'}
                onCheck={(range) => toggle(l.id, range)}
                onOpen={() => {
                  setFocusIdx(i);
                  navigate(`/links/${l.id}${window.location.search}`);
                }}
                onChanged={invalidate}
              />
            ))}
          </div>

          {pages > 1 && (
            <div className="pager">
              <span>
                {num((page - 1) * PAGE + 1)}–{num(Math.min(page * PAGE, total))} von {num(total)}
              </span>
              <div className="row">
                <button className="btn sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>
                  Zurück
                </button>
                <span className="small muted">
                  Seite {page} von {pages}
                </span>
                <button className="btn sm" disabled={page >= pages} onClick={() => setParam({ page: String(page + 1) })}>
                  Weiter
                </button>
              </div>
            </div>
          )}

          {checked.size > 0 && (
            <BulkBar ids={[...checked]} selected={items.filter((l) => checked.has(l.id))} onDone={() => setChecked(new Set())} canEdit={canCreate} />
          )}
        </div>
      </div>
      {selectedId && (
        <>
          <div className="inspector-backdrop" onClick={() => navigate(`/${window.location.search}`)} />
          <Inspector id={selectedId} onClose={() => navigate(`/${window.location.search}`)} />
        </>
      )}
    </div>
  );
}

/** Sieht der Suchbegriff wie eine Webadresse aus? Dann lohnt „Jetzt kürzen“ statt Suchen. */
function looksLikeUrl(q: string): boolean {
  const s = q.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return true;
  return /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(s);
}

function EmptyState({
  filtered,
  query,
  otherFilters,
  onClearSearch,
  canCreate,
}: {
  filtered: boolean;
  query: string;
  otherFilters: boolean;
  onClearSearch: () => void;
  canCreate: boolean;
}) {
  const navigate = useNavigate();
  if (query) {
    const url = looksLikeUrl(query);
    return (
      <Empty
        title={`Keine Links zu ‚${query}‘`}
        art={false}
        action={
          <div className="row wrap" style={{ justifyContent: 'center' }}>
            {url && canCreate && (
              <button className="btn thread" onClick={() => navigate(`/neu?url=${encodeURIComponent(query.trim())}`)}>
                <Scissors /> Jetzt kürzen
              </button>
            )}
            <button className="btn" onClick={onClearSearch}>
              <X /> Suche leeren
            </button>
            {otherFilters && (
              <button className="btn ghost" onClick={() => navigate('/')}>
                Alle Filter zurücksetzen
              </button>
            )}
          </div>
        }
      >
        {url && canCreate
          ? 'In dieser Ansicht taucht die Adresse nicht auf. Mit „Jetzt kürzen“ legen Sie dafür einen Kurzlink an.'
          : otherFilters
            ? 'Auch die gesetzten Filter schränken die Suche ein. Versuchen Sie einen anderen Begriff oder entfernen Sie Filter.'
            : 'Gesucht wird in Kurzadresse, Ziel, Titel, Notizen und Schlagwörtern. Versuchen Sie einen anderen Begriff.'}
      </Empty>
    );
  }
  if (filtered) {
    return (
      <Empty title="Keine Treffer" art={false} action={<button className="btn" onClick={() => navigate('/')}>Filter zurücksetzen</button>}>
        Mit diesen Filtern gibt es keine Links. Entfernen Sie einzelne Filter oder setzen Sie alle zurück.
      </Empty>
    );
  }
  return (
    <Empty
      title="Noch keine Links"
      action={
        canCreate ? (
          <div className="row wrap" style={{ justifyContent: 'center' }}>
            <button className="btn thread" onClick={() => window.dispatchEvent(new CustomEvent('filum:compose'))}>
              Ersten Link anlegen
            </button>
            <RouterLink className="btn" to="/einstellungen/import">
              <Upload /> Vorhandene Links importieren
            </RouterLink>
          </div>
        ) : undefined
      }
    >
      Fügen Sie oben eine lange Adresse ein und drücken Sie Enter. Der Kurzlink liegt danach sofort in Ihrer Zwischenablage.
    </Empty>
  );
}

function LinkRow({
  link,
  selected,
  fresh,
  checked,
  hostMode,
  onCheck,
  onOpen,
  onChanged,
}: {
  link: Link;
  selected: boolean;
  fresh: boolean;
  checked: boolean;
  hostMode: 'show' | 'quiet';
  /** range = Shift gedrückt: Bereich ab der zuletzt markierten Zeile */
  onCheck: (range: boolean) => void;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const { host, rest } = splitUrl(link.url);
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const title = link.title || link.meta.title;
  const icon = link.meta.iconUrl;

  const act = async (fn: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) => {
    setMenu(false);
    try {
      await fn();
      onChanged();
      toast.ok(msg, undo ? { label: 'Rückgängig', run: () => void undo().then(onChanged) } : undefined);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div
      className={`link-row ${fresh ? 'fresh' : ''} ${link.archived ? 'archived' : ''}`}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      data-link-id={link.id}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen();
      }}
    >
      <div className="row-icon" aria-hidden={!checked}>
        {icon ? <img src={icon} alt="" loading="lazy" /> : <span>{(host[0] ?? '?').toUpperCase()}</span>}
        <label className={`row-check ${checked ? 'on' : ''}`} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={checked}
            // Klick statt change, damit Shift für die Bereichsauswahl lesbar ist (Leertaste löst ebenfalls click aus).
            onClick={(e) => onCheck(e.shiftKey)}
            onChange={() => undefined}
            aria-label={`${link.slug} auswählen`}
            title="Auswählen – mit Umschalttaste einen Bereich"
            style={{ accentColor: 'var(--thread)', width: 16, height: 16 }}
          />
        </label>
      </div>
      <div className="row-main">
        <div className="row-line">
          <ShortLabel host={link.domain.host} slug={link.slug} hostMode={hostMode} />
          {link.health.status === 'broken' && (
            // Nur auf schmalen Bildschirmen sichtbar, dort fehlt die Status-Spalte.
            <span className="icon-badge warn row-health-narrow" title={link.health.detail ?? 'Ziel gestört'}>
              <TriangleAlert />
            </span>
          )}
          {link.favorite && (
            <span className="icon-badge thread" title="Favorit">
              <Star fill="currentColor" />
            </span>
          )}
          {link.protected && (
            <span className="icon-badge" title="Verteilt – geschützt vor versehentlichem Ändern">
              <ShieldCheck />
            </span>
          )}
          {link.hasPassword && (
            <span className="icon-badge" title="Passwortgeschützt">
              <Lock />
            </span>
          )}
          {title && (
            <span className="row-title muted" style={{ fontWeight: 450, fontSize: 'var(--fs-sm)' }}>
              {title}
            </span>
          )}
        </div>
        <div className="row-line">
          <span className="thread-line" style={{ maxWidth: 28, minWidth: 14, flex: 'none' }} aria-hidden />
          <span className="row-dest" title={link.url}>
            <b>{host}</b>
            {rest}
          </span>
        </div>
        <RowMeta link={link} />
      </div>
      <div className="row-clicks" title={link.lastClickAt ? `Zuletzt aufgerufen ${relative(link.lastClickAt)}` : 'Noch nie aufgerufen'}>
        <strong>{compact(link.clicks)}</strong>
        <Spark data={link.spark} />
      </div>
      <StateBadge state={link.state} archived={link.archived} health={link.health} />
      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
        <button ref={menuRef} className="btn ghost icon sm" onClick={() => setMenu((o) => !o)} aria-label={`Aktionen für ${link.slug}`} aria-haspopup="menu">
          <MoreHorizontal />
        </button>
        <Popover anchor={menuRef} open={menu} onClose={() => setMenu(false)} role="menu" align="end" label="Aktionen">
          <MenuItem
            icon={<Copy />}
            onSelect={() => {
              setMenu(false);
              void copyText(link.shortUrl).then((ok) => ok && toast.ok('Kurzlink kopiert'));
            }}
            kbd="C"
          >
            Kurzlink kopieren
          </MenuItem>
          <MenuItem icon={<Star />} onSelect={() => void act(() => api.post(`/api/v1/links/${link.id}/favorite`, { favorite: !link.favorite }), link.favorite ? 'Aus Favoriten entfernt' : 'Zu Favoriten hinzugefügt')}>
            {link.favorite ? 'Kein Favorit mehr' : 'Als Favorit merken'}
          </MenuItem>
          {link.canEdit && (
            <>
              <MenuItem icon={<Copy />} onSelect={() => void act(() => api.post(`/api/v1/links/${link.id}/duplicate`), 'Kopie angelegt')}>
                Duplizieren
              </MenuItem>
              <div className="menu-sep" />
              {link.enabled ? (
                <MenuItem
                  icon={<CircleOff />}
                  onSelect={() =>
                    void act(
                      () => api.patch(`/api/v1/links/${link.id}`, { enabled: false }),
                      'Link deaktiviert',
                      () => api.patch(`/api/v1/links/${link.id}`, { enabled: true }),
                    )
                  }
                >
                  Deaktivieren
                </MenuItem>
              ) : (
                <MenuItem icon={<Play />} onSelect={() => void act(() => api.patch(`/api/v1/links/${link.id}`, { enabled: true }), 'Link wieder aktiv')}>
                  Reaktivieren
                </MenuItem>
              )}
              {link.archived ? (
                <MenuItem icon={<ArchiveRestore />} onSelect={() => void act(() => api.patch(`/api/v1/links/${link.id}`, { archived: false }), 'Aus dem Archiv geholt')}>
                  Aus Archiv holen
                </MenuItem>
              ) : (
                <MenuItem
                  icon={<Archive />}
                  onSelect={() =>
                    void act(
                      () => api.patch(`/api/v1/links/${link.id}`, { archived: true }),
                      'Archiviert – der Link funktioniert weiter',
                      () => api.patch(`/api/v1/links/${link.id}`, { archived: false }),
                    )
                  }
                >
                  Archivieren
                </MenuItem>
              )}
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}

const META_MAX = 2;

/** Kampagne, Sammlung und Schlagwörter als unterscheidbare Chips: höchstens zwei sichtbar, Rest als „+n“. */
function RowMeta({ link }: { link: Link }) {
  const chips: { key: string; kind: string; name: string; color: Link['tags'][number]['color']; icon: React.ReactNode }[] = [];
  if (link.campaign) chips.push({ key: 'k', kind: 'Kampagne', name: link.campaign.name, color: link.campaign.color, icon: <Megaphone aria-hidden /> });
  if (link.collection) chips.push({ key: 's', kind: 'Sammlung', name: link.collection.name, color: link.collection.color, icon: <Folder aria-hidden /> });
  for (const t of link.tags) chips.push({ key: `t${t.id}`, kind: 'Schlagwort', name: t.name, color: t.color, icon: <TagIcon aria-hidden /> });
  if (!chips.length) return null;
  const shown = chips.slice(0, META_MAX);
  const rest = chips.slice(META_MAX);
  return (
    <div className="row-meta">
      {shown.map((c) => (
        <TagChip key={c.key} name={c.name} color={c.color} icon={c.icon} title={`${c.kind}: ${c.name}`} />
      ))}
      {rest.length > 0 && (
        <span className="row-meta-more" title={rest.map((c) => `${c.kind}: ${c.name}`).join('\n')} aria-label={`${rest.length} weitere: ${rest.map((c) => c.name).join(', ')}`}>
          +{rest.length}
        </span>
      )}
    </div>
  );
}

function SelectChip({
  icon,
  label,
  options,
  value,
  onChange,
  pressed,
  align,
}: {
  icon: React.ReactNode;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  pressed?: boolean;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} className="filter-chip" aria-pressed={pressed ?? false} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {icon}
        {label}
        <ChevronDown />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} role="menu" align={align}>
        {options.map((o) => (
          <MenuItem
            key={o.value}
            onSelect={() => {
              onChange(o.value);
              setOpen(false);
            }}
          >
            <span style={{ fontWeight: o.value === value ? 650 : 450 }}>{o.label}</span>
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

function FilterMenu({
  onPick,
  tags,
  collections,
  campaigns,
  domains,
}: {
  onPick: (p: Record<string, string | null>) => void;
  tags: { id: number; name: string }[];
  collections: { id: number; name: string }[];
  campaigns: { id: number; name: string }[];
  domains: { id: number; host: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [fq, setFq] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  const pick = (p: Record<string, string | null>) => {
    onPick(p);
    setOpen(false);
    setFq('');
  };
  const fm = (s: string) => !fq.trim() || s.toLowerCase().includes(fq.trim().toLowerCase());
  const manyOptions = tags.length + collections.length + campaigns.length + domains.length > 8;
  return (
    <>
      <button ref={ref} className="filter-chip" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Filter />
        Filtern
        <ChevronDown />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} role="menu" width={280}>
        {manyOptions && (
          <div style={{ padding: '2px 2px 6px' }}>
            <input className="input" style={{ minHeight: 32, padding: '5px 9px', fontSize: 'var(--fs-sm)' }} value={fq} onChange={(e) => setFq(e.target.value)} placeholder="Filter suchen …" aria-label="Filter suchen" />
          </div>
        )}
        <div style={{ maxHeight: 'min(420px, calc(100vh - 160px))', overflowY: 'auto' }}>
          <MenuItem icon={<Star />} onSelect={() => pick({ favorite: '1' })}>
            Favoriten
          </MenuItem>
          <MenuItem icon={<ShieldCheck />} onSelect={() => pick({ protected: '1' })}>
            Verteilt & geschützt
          </MenuItem>
          <MenuItem icon={<TriangleAlert />} onSelect={() => pick({ health: 'broken' })}>
            Ziel gestört
          </MenuItem>
          {domains.length > 1 && (
            <>
              <div className="menu-label">Domain</div>
              {domains.filter((d) => fm(d.host)).map((d) => (
                <MenuItem key={d.id} icon={<Globe />} onSelect={() => pick({ domainId: String(d.id) })}>
                  <span className="mono">{d.host}</span>
                </MenuItem>
              ))}
            </>
          )}
          {collections.length > 0 && (
            <>
              <div className="menu-label">Sammlung</div>
              {collections.filter((c) => fm(c.name)).map((c) => (
                <MenuItem key={c.id} icon={<FolderInput />} onSelect={() => pick({ collectionId: String(c.id) })}>
                  {c.name}
                </MenuItem>
              ))}
              <MenuItem icon={<FolderInput />} onSelect={() => pick({ collectionId: 'none' })}>
                <span className="muted">Ohne Sammlung</span>
              </MenuItem>
            </>
          )}
          {campaigns.length > 0 && (
            <>
              <div className="menu-label">Kampagne</div>
              {campaigns.filter((c) => fm(c.name)).map((c) => (
                <MenuItem key={c.id} onSelect={() => pick({ campaignId: String(c.id) })}>
                  {c.name}
                </MenuItem>
              ))}
            </>
          )}
          {tags.length > 0 && (
            <>
              <div className="menu-label">Schlagwort</div>
              {tags.filter((t) => fm(t.name)).slice(0, 40).map((t) => (
                <MenuItem key={t.id} icon={<TagIcon />} onSelect={() => pick({ tag: t.name })}>
                  {t.name}
                </MenuItem>
              ))}
            </>
          )}
        </div>
      </Popover>
    </>
  );
}

function ExportMenu({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const base = useMemo(() => {
    const p = new URLSearchParams(query.slice(1));
    p.delete('limit');
    p.delete('offset');
    return p;
  }, [query]);
  const href = (format: string) => {
    const p = new URLSearchParams(base);
    p.set('format', format);
    return `/api/v1/export?${p.toString()}`;
  };
  return (
    <>
      <button ref={ref} className="filter-chip" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-label="Exportieren">
        <Download />
        Export
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} role="menu" align="end">
        <div className="menu-label">Aktuelle Ansicht exportieren</div>
        <a className="menu-item" role="menuitem" href={href('csv')} onClick={() => setOpen(false)}>
          <Download /> CSV für Excel und LibreOffice
        </a>
        <a className="menu-item" role="menuitem" href={href('json')} onClick={() => setOpen(false)}>
          <Download /> JSON mit allen Feldern
        </a>
        <div className="menu-sep" />
        <RouterLink className="menu-item" role="menuitem" to="/einstellungen/import">
          <Upload /> Links importieren
        </RouterLink>
      </Popover>
    </>
  );
}

function BulkBar({ ids, selected, onDone, canEdit }: { ids: number[]; selected: Link[]; onDone: () => void; canEdit: boolean }) {
  const toast = useToast();
  const invalidate = useInvalidateLinks();
  const tags = useTags();
  const collections = useCollections();
  const campaigns = useCampaigns();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menu, setMenu] = useState<'tag' | 'collection' | 'campaign' | 'more' | null>(null);
  const tagRef = useRef<HTMLButtonElement>(null);
  const colRef = useRef<HTMLButtonElement>(null);
  const campRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [newTag, setNewTag] = useState('');

  // Welche Aktionen passen zur Auswahl? Ohne Kenntnis der Zeilen (sollte nicht vorkommen) alles anbieten.
  const known = selected.length > 0;
  const some = (f: (l: Link) => boolean) => !known || selected.some(f);
  const anyEnabled = some((l) => l.enabled);
  const anyDisabled = some((l) => !l.enabled);
  const anyArchived = some((l) => l.archived);
  const anyLive = some((l) => !l.archived);
  const anyFav = some((l) => l.favorite);
  const anyNoFav = some((l) => !l.favorite);
  const anyProtected = some((l) => l.protected);
  const anyUnprotected = some((l) => !l.protected);
  const protectedCount = selected.filter((l) => l.protected).length;
  const activeCampaigns = (campaigns.data?.items ?? []).filter((c) => !c.archived);

  const run = async (action: Record<string, unknown>, msg: string, confirmProtected = false) => {
    setBusy(true);
    setMenu(null);
    try {
      const r = await api.post<{ ok: number; failed: { id: number; error: string }[] }>('/api/v1/links/bulk', { ids, action, confirmProtected });
      invalidate();
      if (r.failed.length) toast.error(`${msg}: ${r.ok} erledigt, ${r.failed.length} nicht möglich (${r.failed[0].error})`);
      else toast.ok(`${msg}: ${r.ok} ${r.ok === 1 ? 'Link' : 'Links'}`);
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="bulk-bar" role="toolbar" aria-label="Aktionen für die Auswahl">
      <strong className="small" style={{ marginRight: 6 }} title="Tipp: Mit gedrückter Umschalttaste einen ganzen Bereich auswählen">
        {ids.length} ausgewählt
      </strong>
      <a className="btn sm" href={`/api/v1/export?format=csv&state=all&ids=${ids.join(',')}`}>
        <Download /> Export
      </a>
      {canEdit && (
        <>
          <button ref={tagRef} className="btn sm" onClick={() => setMenu(menu === 'tag' ? null : 'tag')} disabled={busy} aria-haspopup="menu" aria-expanded={menu === 'tag'}>
            <TagIcon /> Schlagwort
          </button>
          <Popover anchor={tagRef} open={menu === 'tag'} onClose={() => setMenu(null)} width={260}>
            <form
              className="row"
              style={{ padding: 4 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (newTag.trim()) void run({ type: 'addTags', tags: [newTag.trim()] }, `„${newTag.trim()}“ hinzugefügt`);
                setNewTag('');
              }}
            >
              <input className="input" autoFocus placeholder="Neues oder vorhandenes Schlagwort" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
            </form>
            {(tags.data?.items ?? []).slice(0, 12).map((t) => (
              <MenuItem key={t.id} icon={<TagIcon />} onSelect={() => void run({ type: 'addTags', tags: [t.name] }, `„${t.name}“ hinzugefügt`)}>
                {t.name}
              </MenuItem>
            ))}
          </Popover>
          <button ref={colRef} className="btn sm" onClick={() => setMenu(menu === 'collection' ? null : 'collection')} disabled={busy} aria-haspopup="menu" aria-expanded={menu === 'collection'}>
            <Folder /> Sammlung
          </button>
          <Popover anchor={colRef} open={menu === 'collection'} onClose={() => setMenu(null)} role="menu">
            {(collections.data?.items ?? []).map((c) => (
              <MenuItem key={c.id} icon={<Folder />} onSelect={() => void run({ type: 'setCollection', collectionId: c.id }, `In „${c.name}“ verschoben`)}>
                {c.name}
              </MenuItem>
            ))}
            <MenuItem onSelect={() => void run({ type: 'setCollection', collectionId: null }, 'Aus Sammlung entfernt')}>
              <span className="muted">Keine Sammlung</span>
            </MenuItem>
            {!collections.data?.items.length && <div className="menu-label">Sammlungen legt die Redaktion in den Einstellungen an.</div>}
          </Popover>
          <button ref={campRef} className="btn sm" onClick={() => setMenu(menu === 'campaign' ? null : 'campaign')} disabled={busy} aria-haspopup="menu" aria-expanded={menu === 'campaign'}>
            <Megaphone /> Kampagne
          </button>
          <Popover anchor={campRef} open={menu === 'campaign'} onClose={() => setMenu(null)} role="menu" label="Kampagne zuordnen">
            <div className="menu-label">Kampagne zuordnen</div>
            {activeCampaigns.map((c) => (
              <MenuItem key={c.id} icon={<Megaphone />} onSelect={() => void run({ type: 'setCampaign', campaignId: c.id }, `Kampagne „${c.name}“ zugeordnet`)}>
                {c.name}
              </MenuItem>
            ))}
            <MenuItem onSelect={() => void run({ type: 'setCampaign', campaignId: null }, 'Aus Kampagne entfernt')}>
              <span className="muted">Keine Kampagne</span>
            </MenuItem>
            {!activeCampaigns.length && (
              <RouterLink className="menu-item" role="menuitem" to="/kampagnen">
                <Megaphone /> Kampagne anlegen …
              </RouterLink>
            )}
          </Popover>
          {anyEnabled && (
            <button className="btn sm" onClick={() => void run({ type: 'disable' }, 'Deaktiviert')} disabled={busy}>
              <CircleOff /> Deaktivieren
            </button>
          )}
          {anyDisabled && (
            <button className="btn sm" onClick={() => void run({ type: 'enable' }, 'Aktiviert')} disabled={busy}>
              <Play /> Aktivieren
            </button>
          )}
          <button
            ref={moreRef}
            className="btn sm"
            onClick={() => setMenu(menu === 'more' ? null : 'more')}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={menu === 'more'}
            aria-label="Mehr Aktionen für die Auswahl"
          >
            <MoreHorizontal /> Mehr
          </button>
          <Popover anchor={moreRef} open={menu === 'more'} onClose={() => setMenu(null)} role="menu" align="end" label="Mehr Aktionen für die Auswahl">
            {anyNoFav && (
              <MenuItem icon={<Star />} onSelect={() => void run({ type: 'favorite' }, 'Als Favorit gemerkt')}>
                Als Favorit merken
              </MenuItem>
            )}
            {anyFav && (
              <MenuItem icon={<StarOff />} onSelect={() => void run({ type: 'unfavorite' }, 'Aus Favoriten entfernt')}>
                Kein Favorit mehr
              </MenuItem>
            )}
            <div className="menu-sep" />
            {anyUnprotected && (
              <MenuItem icon={<ShieldCheck />} onSelect={() => void run({ type: 'protect' }, 'Als verteilt geschützt')}>
                Als verteilt schützen
              </MenuItem>
            )}
            {anyProtected && (
              <MenuItem icon={<ShieldOff />} onSelect={() => void run({ type: 'unprotect' }, 'Schutz aufgehoben')}>
                Schutz aufheben
              </MenuItem>
            )}
            <div className="menu-sep" />
            {anyLive && (
              <MenuItem icon={<Archive />} onSelect={() => void run({ type: 'archive' }, 'Archiviert')}>
                Archivieren
              </MenuItem>
            )}
            {anyArchived && (
              <MenuItem icon={<ArchiveRestore />} onSelect={() => void run({ type: 'unarchive' }, 'Aus dem Archiv geholt')}>
                Aus Archiv holen
              </MenuItem>
            )}
          </Popover>
          {confirmDelete ? (
            <button
              className="btn sm danger solid"
              onClick={() => void run({ type: 'delete' }, 'Gelöscht', protectedCount > 0)}
              disabled={busy}
              title={protectedCount > 0 ? 'Geschützte Links sind verteilt – wer sie gedruckt oder verschickt hat, landet danach auf einer Fehlerseite.' : undefined}
            >
              <Trash2 /> {ids.length} endgültig löschen{protectedCount > 0 ? `, davon ${protectedCount} geschützt` : ''}
            </button>
          ) : (
            <button className="btn sm" onClick={() => setConfirmDelete(true)} disabled={busy}>
              <Trash2 /> Löschen
            </button>
          )}
        </>
      )}
      <button className="btn sm icon" onClick={onDone} aria-label="Auswahl aufheben">
        <X />
      </button>
    </div>
  );
}
