import { Card, EmptyState, PageHeader, Section } from "@/components/ui";

/**
 * Écran rendu à la place d'une page dont l'employé n'a pas la permission
 * `*.voir`. Pas un 404 : la RLS protège déjà les données, cette garde est de
 * l'UX — l'employé doit comprendre qu'il lui manque un droit, pas croire la
 * page disparue.
 */
export function AccessRestricted({
  breadcrumb,
  title,
  permissionLabel,
}: {
  breadcrumb: string[];
  title: string;
  permissionLabel: string;
}) {
  return (
    <>
      <PageHeader breadcrumb={breadcrumb} title={title} />
      <Section>
        <Card>
          <EmptyState
            title="Accès restreint"
            hint={`Cette page requiert le droit « ${permissionLabel} ». Demandez-le à un administrateur (Réglages → Permissions).`}
          />
        </Card>
      </Section>
    </>
  );
}
