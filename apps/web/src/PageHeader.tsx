import React from 'react';
import { Icon, type IconName } from './Icon';

export function PageHeader({ eyebrow, title, description, icon }: { eyebrow: string; title: string; description: string; icon: IconName }) {
  return <div className="page-header"><div className="page-header-copy"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div><div className="workspace-emblem" aria-hidden="true"><span className="emblem-orbit" /><span className="emblem-orbit inner" /><span className="emblem-spark" /><span className="emblem-tile"><Icon name={icon} /></span></div></div>;
}
