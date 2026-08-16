'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, Plus, Trash2, Wand2 } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  createOffer,
  deleteOffer,
  designOffer,
  listOffers,
  updateOffer,
  type DesignedOffer,
  type Offer,
  type OfferStatus,
} from '@/lib/sales';

const OFFER_STATUSES: OfferStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED'];

function statusVariant(status: OfferStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'ACCEPTED':
      return 'default';
    case 'DECLINED':
      return 'destructive';
    case 'SENT':
      return 'default';
    case 'DRAFT':
      return 'outline';
  }
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function OfferCard({
  offer,
  onStatusChange,
  onDelete,
}: {
  offer: Offer;
  onStatusChange: (status: OfferStatus) => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{offer.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatMoney(offer.suggestedPrice)} · {offer.targetMargin}% margin · Created{' '}
            {formatDate(offer.createdAt)}
          </p>
        </div>
        <Badge variant={statusVariant(offer.status)}>{offer.status}</Badge>
      </div>
      {offer.description && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{offer.description}</p>
      )}
      {offer.components.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {offer.components.map((component) => (
            <span
              key={component}
              className="rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground"
            >
              {component}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <select
          className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
          value={offer.status}
          onChange={(event) => onStatusChange(event.target.value as OfferStatus)}
          aria-label="Update offer status"
        >
          {OFFER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </div>
    </div>
  );
}

export default function OffersPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [offers, setOffers] = React.useState<Offer[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [suggestedPrice, setSuggestedPrice] = React.useState('');
  const [minimumPrice, setMinimumPrice] = React.useState('');
  const [components, setComponents] = React.useState('');
  const [targetMargin, setTargetMargin] = React.useState('30');
  const [creating, setCreating] = React.useState(false);

  const [designCompany, setDesignCompany] = React.useState('');
  const [designContext, setDesignContext] = React.useState('');
  const [designing, setDesigning] = React.useState(false);
  const [designed, setDesigned] = React.useState<DesignedOffer | null>(null);

  React.useEffect(() => {
    let disposed = false;
    async function load(): Promise<void> {
      try {
        const list = await listOffers();
        if (!disposed) {
          setOffers(list);
          setError(null);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        if (!disposed) {
          setError('Failed to load offers.');
        }
      } finally {
        if (!disposed) {
          setLoaded(true);
        }
      }
    }
    void load();
    return () => {
      disposed = true;
    };
  }, [router, logout]);

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (creating) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const offer = await createOffer({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(suggestedPrice.trim() ? { suggestedPrice: Number(suggestedPrice) } : {}),
        ...(minimumPrice.trim() ? { minimumPrice: Number(minimumPrice) } : {}),
        targetMargin: Number(targetMargin) || 30,
        ...(components.trim()
          ? {
              components: components
                .split(',')
                .map((component) => component.trim())
                .filter(Boolean),
            }
          : {}),
      });
      setOffers((previous) => [offer, ...previous]);
      setName('');
      setDescription('');
      setSuggestedPrice('');
      setMinimumPrice('');
      setComponents('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to create the offer.');
    } finally {
      setCreating(false);
    }
  }

  async function runDesign(): Promise<void> {
    if (!designCompany.trim()) {
      setError('Provide a company to design an offer for.');
      return;
    }
    setDesigning(true);
    setError(null);
    try {
      const result = await designOffer({
        companyName: designCompany.trim(),
        context: designContext.trim() || undefined,
      });
      setDesigned(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Offer design failed.');
    } finally {
      setDesigning(false);
    }
  }

  async function saveDesigned(): Promise<void> {
    if (!designed) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const offer = await createOffer({
        name: designed.name,
        description: designed.description,
        components: designed.components,
        suggestedPrice: designed.suggestedPrice,
        minimumPrice: designed.minimumPrice,
        targetMargin: designed.targetMargin,
        currency: designed.currency,
        deliveryEstimate: designed.deliveryEstimate,
        validDays: designed.validDays,
      });
      setOffers((previous) => [offer, ...previous]);
      setDesigned(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to save the designed offer.');
    } finally {
      setCreating(false);
    }
  }

  if (user === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <DashboardPageHeader
        title="Offers"
        description="Design, price, and track offers for your opportunities and leads."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create an offer</CardTitle>
            <CardDescription>Manually add an offer with components and pricing.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="offer-name" className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id="offer-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Website + SEO launch"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="offer-description" className="text-sm font-medium">
                  Description
                </label>
                <Input
                  id="offer-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What the client gets"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="offer-price" className="text-sm font-medium">
                    Suggested price (USD)
                  </label>
                  <Input
                    id="offer-price"
                    type="number"
                    min={0}
                    value={suggestedPrice}
                    onChange={(event) => setSuggestedPrice(event.target.value)}
                    placeholder="3200"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="offer-min" className="text-sm font-medium">
                    Minimum price (USD)
                  </label>
                  <Input
                    id="offer-min"
                    type="number"
                    min={0}
                    value={minimumPrice}
                    onChange={(event) => setMinimumPrice(event.target.value)}
                    placeholder="1900"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="offer-margin" className="text-sm font-medium">
                    Target margin (%)
                  </label>
                  <Input
                    id="offer-margin"
                    type="number"
                    min={0}
                    max={90}
                    value={targetMargin}
                    onChange={(event) => setTargetMargin(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="offer-components" className="text-sm font-medium">
                    Components (comma separated)
                  </label>
                  <Input
                    id="offer-components"
                    value={components}
                    onChange={(event) => setComponents(event.target.value)}
                    placeholder="Website development, On-page SEO"
                  />
                </div>
              </div>
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create offer
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Design with AI</CardTitle>
            <CardDescription>
              BRO composes a tailored offer from your service catalog for a prospect.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="design-company" className="text-sm font-medium">
                Company
              </label>
              <Input
                id="design-company"
                value={designCompany}
                onChange={(event) => setDesignCompany(event.target.value)}
                placeholder="Acme"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="design-context" className="text-sm font-medium">
                Context
              </label>
              <Input
                id="design-context"
                value={designContext}
                onChange={(event) => setDesignContext(event.target.value)}
                placeholder="They need a booking system and are in a hurry"
              />
            </div>
            <Button onClick={() => void runDesign()} disabled={designing}>
              {designing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              Design offer
            </Button>
            {designed && (
              <div className="rounded-lg border p-3">
                <p className="font-medium">{designed.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{designed.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {designed.components.map((component) => (
                    <span
                      key={component}
                      className="rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {component}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-sm">
                  {formatMoney(designed.suggestedPrice)} · min {formatMoney(designed.minimumPrice)}{' '}
                  · {designed.deliveryEstimate}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{designed.rationale}</p>
                {designed.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {designed.warnings.map((warning) => (
                      <li key={warning} className="text-xs text-amber-500">
                        {warning}
                      </li>
                    ))}
                  </ul>
                )}
                <Button className="mt-3" size="sm" onClick={() => void saveDesigned()}>
                  <FileText className="h-3.5 w-3.5" /> Save offer
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">All offers</h2>
        {!loaded ? (
          <div className="flex min-h-[20vh] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : offers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No offers yet. Create one or design one with AI.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {offers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                onStatusChange={async (status) => {
                  const updated = await updateOffer(offer.id, { status });
                  setOffers((previous) =>
                    previous.map((item) => (item.id === updated.id ? updated : item)),
                  );
                }}
                onDelete={async () => {
                  await deleteOffer(offer.id);
                  setOffers((previous) => previous.filter((item) => item.id !== offer.id));
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
