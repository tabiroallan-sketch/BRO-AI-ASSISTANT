'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, User, Shield, Sparkles, TrendingUp } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  analyzeMargin,
  buildNegotiationStrategy,
  buildPersona,
  prepareObjections,
  type MarginAnalysis,
  type NegotiationStrategy,
  type ObjectionPlaybook,
  type Persona,
} from '@/lib/sales';

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

function marginVariant(status: MarginAnalysis['status']): 'default' | 'destructive' | 'secondary' {
  switch (status) {
    case 'healthy':
      return 'default';
    case 'thin':
      return 'secondary';
    case 'at-risk':
      return 'destructive';
  }
}

function ListBlock({ title, items }: { title: string; items: string[] }): React.JSX.Element {
  if (!items || items.length === 0) {
    return (
      <div>
        <h4 className="mb-1 text-sm font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground">—</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-neon-cyan">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SalesIntelligencePage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [error, setError] = React.useState<string | null>(null);

  const [personaCompany, setPersonaCompany] = React.useState('');
  const [personaContext, setPersonaContext] = React.useState('');
  const [personaBusy, setPersonaBusy] = React.useState(false);
  const [persona, setPersona] = React.useState<Persona | null>(null);

  const [objCompany, setObjCompany] = React.useState('');
  const [objOffer, setObjOffer] = React.useState('');
  const [objPrice, setObjPrice] = React.useState('');
  const [objBusy, setObjBusy] = React.useState(false);
  const [playbook, setPlaybook] = React.useState<ObjectionPlaybook | null>(null);

  const [negCompany, setNegCompany] = React.useState('');
  const [negOffer, setNegOffer] = React.useState('');
  const [negMin, setNegMin] = React.useState('');
  const [negTarget, setNegTarget] = React.useState('');
  const [negBusy, setNegBusy] = React.useState(false);
  const [strategy, setStrategy] = React.useState<NegotiationStrategy | null>(null);

  const [marginMin, setMarginMin] = React.useState('');
  const [marginTarget, setMarginTarget] = React.useState('');
  const [marginTargetMargin, setMarginTargetMargin] = React.useState('40');
  const [marginCost, setMarginCost] = React.useState('');
  const [marginBusy, setMarginBusy] = React.useState(false);
  const [margin, setMargin] = React.useState<MarginAnalysis | null>(null);

  function handleAuthError(err: unknown, fallback: string): void {
    if (err instanceof ApiError && err.status === 401) {
      void logout().then(() => router.replace('/login'));
      return;
    }
    setError(err instanceof Error ? err.message : fallback);
  }

  async function runPersona(): Promise<void> {
    if (!personaCompany.trim()) {
      setError('Provide a company name.');
      return;
    }
    setPersonaBusy(true);
    setError(null);
    try {
      setPersona(
        await buildPersona({
          companyName: personaCompany.trim(),
          context: personaContext.trim() || undefined,
        }),
      );
    } catch (err) {
      handleAuthError(err, 'Persona generation failed.');
    } finally {
      setPersonaBusy(false);
    }
  }

  async function runObjections(): Promise<void> {
    if (!objCompany.trim()) {
      setError('Provide a company name.');
      return;
    }
    setObjBusy(true);
    setError(null);
    try {
      setPlaybook(
        await prepareObjections({
          companyName: objCompany.trim(),
          offer: objOffer.trim() || undefined,
          price: objPrice.trim() || undefined,
        }),
      );
    } catch (err) {
      handleAuthError(err, 'Objection preparation failed.');
    } finally {
      setObjBusy(false);
    }
  }

  async function runNegotiation(): Promise<void> {
    if (!negCompany.trim()) {
      setError('Provide a company name.');
      return;
    }
    setNegBusy(true);
    setError(null);
    try {
      setStrategy(
        await buildNegotiationStrategy({
          companyName: negCompany.trim(),
          offer: negOffer.trim() || undefined,
          minimumPrice: negMin.trim() ? Number(negMin) : undefined,
          targetPrice: negTarget.trim() ? Number(negTarget) : undefined,
        }),
      );
    } catch (err) {
      handleAuthError(err, 'Negotiation strategy failed.');
    } finally {
      setNegBusy(false);
    }
  }

  async function runMargin(): Promise<void> {
    setMarginBusy(true);
    setError(null);
    try {
      setMargin(
        await analyzeMargin({
          minimumPrice: marginMin.trim() ? Number(marginMin) : undefined,
          targetPrice: marginTarget.trim() ? Number(marginTarget) : undefined,
          targetMargin: marginTargetMargin.trim() ? Number(marginTargetMargin) : undefined,
          estimatedCost: marginCost.trim() ? Number(marginCost) : undefined,
        }),
      );
    } catch (err) {
      handleAuthError(err, 'Margin analysis failed.');
    } finally {
      setMarginBusy(false);
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
        title="Sales intelligence"
        description="AI-assisted personas, objection playbooks, negotiation strategies, and margin analysis."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" /> Buyer persona
            </CardTitle>
            <CardDescription>Understand the decision maker before you reach out.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="persona-company" className="text-sm font-medium">
                Company
              </label>
              <Input
                id="persona-company"
                value={personaCompany}
                onChange={(event) => setPersonaCompany(event.target.value)}
                placeholder="Acme"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="persona-context" className="text-sm font-medium">
                Context
              </label>
              <Input
                id="persona-context"
                value={personaContext}
                onChange={(event) => setPersonaContext(event.target.value)}
                placeholder="They reached out about a new website"
              />
            </div>
            <Button onClick={() => void runPersona()} disabled={personaBusy}>
              {personaBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Build persona
            </Button>
            {persona && (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="font-medium">{persona.title}</p>
                <p className="text-sm text-muted-foreground">{persona.summary}</p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Role: </span>
                  {persona.role} · {persona.decisionStyle}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Preferred channel: </span>
                  {persona.preferredChannel}
                </p>
                <ListBlock title="Buying drivers" items={persona.buyingDrivers} />
                <ListBlock title="Communication tips" items={persona.communicationTips} />
                {persona.warnings.length > 0 && (
                  <ul className="space-y-1">
                    {persona.warnings.map((warning) => (
                      <li key={warning} className="flex gap-2 text-xs text-amber-500">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        {warning}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" /> Objection playbook
            </CardTitle>
            <CardDescription>Prepare for objections before they happen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="obj-company" className="text-sm font-medium">
                Company
              </label>
              <Input
                id="obj-company"
                value={objCompany}
                onChange={(event) => setObjCompany(event.target.value)}
                placeholder="Acme"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="obj-offer" className="text-sm font-medium">
                  Offer
                </label>
                <Input
                  id="obj-offer"
                  value={objOffer}
                  onChange={(event) => setObjOffer(event.target.value)}
                  placeholder="Website + SEO launch"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="obj-price" className="text-sm font-medium">
                  Price
                </label>
                <Input
                  id="obj-price"
                  value={objPrice}
                  onChange={(event) => setObjPrice(event.target.value)}
                  placeholder="$3,200"
                />
              </div>
            </div>
            <Button onClick={() => void runObjections()} disabled={objBusy}>
              {objBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Shield className="h-4 w-4" />
              )}
              Prepare objections
            </Button>
            {playbook && (
              <div className="space-y-3 rounded-lg border p-3">
                {playbook.objections.map((item, index) => (
                  <div key={index} className="rounded-lg bg-muted/50 p-3">
                    <p className="text-sm font-medium">&quot;{item.objection}&quot;</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.response}</p>
                  </div>
                ))}
                <ListBlock title="Signals to watch for" items={playbook.signalsToWatchFor} />
                <ListBlock title="Preparation notes" items={playbook.preparationNotes} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> Negotiation strategy
            </CardTitle>
            <CardDescription>Protect your margin with a grounded strategy.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="neg-company" className="text-sm font-medium">
                Company
              </label>
              <Input
                id="neg-company"
                value={negCompany}
                onChange={(event) => setNegCompany(event.target.value)}
                placeholder="Acme"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="neg-offer" className="text-sm font-medium">
                Offer
              </label>
              <Input
                id="neg-offer"
                value={negOffer}
                onChange={(event) => setNegOffer(event.target.value)}
                placeholder="Website + SEO launch"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="neg-min" className="text-sm font-medium">
                  Minimum price (USD)
                </label>
                <Input
                  id="neg-min"
                  type="number"
                  min={0}
                  value={negMin}
                  onChange={(event) => setNegMin(event.target.value)}
                  placeholder="1900"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="neg-target" className="text-sm font-medium">
                  Target price (USD)
                </label>
                <Input
                  id="neg-target"
                  type="number"
                  min={0}
                  value={negTarget}
                  onChange={(event) => setNegTarget(event.target.value)}
                  placeholder="3200"
                />
              </div>
            </div>
            <Button onClick={() => void runNegotiation()} disabled={negBusy}>
              {negBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <TrendingUp className="h-4 w-4" />
              )}
              Build strategy
            </Button>
            {strategy && (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm">{strategy.strategy}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-muted/50 p-2 text-center">
                    <p className="text-xs text-muted-foreground">Opening</p>
                    <p className="text-sm font-medium">{strategy.anchors.opening}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2 text-center">
                    <p className="text-xs text-muted-foreground">Target</p>
                    <p className="text-sm font-medium">{strategy.anchors.target}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2 text-center">
                    <p className="text-xs text-muted-foreground">Walk away</p>
                    <p className="text-sm font-medium">{strategy.anchors.walkAway}</p>
                  </div>
                </div>
                <ListBlock title="Tactics" items={strategy.tactics} />
                <ListBlock title="Red flags" items={strategy.redFlags} />
                <ListBlock title="Next steps" items={strategy.nextSteps} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" /> Margin analysis
            </CardTitle>
            <CardDescription>Is this price worth taking?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="margin-min" className="text-sm font-medium">
                  Minimum price (USD)
                </label>
                <Input
                  id="margin-min"
                  type="number"
                  min={0}
                  value={marginMin}
                  onChange={(event) => setMarginMin(event.target.value)}
                  placeholder="1000"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="margin-target" className="text-sm font-medium">
                  Price under consideration (USD)
                </label>
                <Input
                  id="margin-target"
                  type="number"
                  min={0}
                  value={marginTarget}
                  onChange={(event) => setMarginTarget(event.target.value)}
                  placeholder="1400"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="margin-margin" className="text-sm font-medium">
                  Target margin (%)
                </label>
                <Input
                  id="margin-margin"
                  type="number"
                  min={0}
                  max={90}
                  value={marginTargetMargin}
                  onChange={(event) => setMarginTargetMargin(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="margin-cost" className="text-sm font-medium">
                  Estimated cost (USD)
                </label>
                <Input
                  id="margin-cost"
                  type="number"
                  min={0}
                  value={marginCost}
                  onChange={(event) => setMarginCost(event.target.value)}
                  placeholder="700"
                />
              </div>
            </div>
            <Button onClick={() => void runMargin()} disabled={marginBusy}>
              {marginBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <TrendingUp className="h-4 w-4" />
              )}
              Analyze margin
            </Button>
            {margin && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Estimated margin</p>
                  <Badge variant={marginVariant(margin.status)}>{margin.status}</Badge>
                </div>
                <p className="text-2xl font-semibold">{margin.estimatedMarginPercent}%</p>
                <p className="text-sm text-muted-foreground">
                  {formatMoney(margin.estimatedMargin)} profit on {formatMoney(margin.targetPrice)}
                </p>
                {margin.notes.length > 0 && (
                  <ul className="space-y-1">
                    {margin.notes.map((note) => (
                      <li key={note} className="flex gap-2 text-xs text-muted-foreground">
                        <span className="text-neon-cyan">•</span>
                        {note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
