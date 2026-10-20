import { useT } from '../lib/i18n';
import { PageHeader } from '../components/ui';
import { PeopleList } from '../components/ImportGroups';
export default function People() { const t = useT(); return <div className="space-y-4"><PageHeader title={t('ppl.title')} subtitle={t('ppl.subtitle')} /><PeopleList /></div>; }
