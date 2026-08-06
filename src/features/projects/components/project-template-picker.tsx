import { Instagram, Linkedin, Monitor, Plus, Smartphone, Twitter, Youtube, type LucideIcon } from 'lucide-react';
import { PROJECT_TEMPLATES, getAspectRatio, type ProjectTemplate } from '../utils/validation';

/**
 * Several presets share an aspect ratio (three are ~16:9), so the silhouette
 * alone can't distinguish them — the platform icon is the primary identifier.
 */
const PLATFORM_ICONS: Record<string, LucideIcon> = {
  YouTube: Youtube,
  Vertical: Smartphone,
  Instagram: Instagram,
  'Twitter/X': Twitter,
  LinkedIn: Linkedin,
};

interface ProjectTemplatePickerProps {
  onSelectTemplate: (template: ProjectTemplate) => void;
  selectedTemplateId?: string;
  onSelectCustom?: () => void;
  isCustomSelected?: boolean;
}

export function ProjectTemplatePicker({
  onSelectTemplate,
  selectedTemplateId,
  onSelectCustom,
  isCustomSelected,
}: ProjectTemplatePickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
       {PROJECT_TEMPLATES.map((template) => {
         const isSelected = selectedTemplateId === template.id;
         const aspectRatio = getAspectRatio(template.width, template.height);
         const resolution = `${template.width}×${template.height}`;
         const Icon = PLATFORM_ICONS[template.platform] ?? Monitor;

         return (
           <button
             key={template.id}
             type="button"
             aria-pressed={isSelected}
             onClick={() => onSelectTemplate(template)}
             className={`group relative flex flex-col gap-2 p-3 panel-bg border rounded-lg transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 ${
               isSelected
                 ? 'border-primary ring-2 ring-primary/30'
                 : 'border-border'
             }`}
           >
             {/* Aspect Ratio Silhouette */}
             <div className="relative h-14 bg-secondary/30 rounded overflow-hidden flex items-center justify-center" style={{ containerType: 'size' }}>
               <div
                 className={`bg-primary/20 border-2 border-dashed rounded-sm ${
                   isSelected ? 'border-primary' : 'border-primary/40'
                 }`}
                 style={{
                   aspectRatio: `${template.width} / ${template.height}`,
                   width: `min(100cqw, ${(template.width / template.height) * 100}cqh)`,
                   height: `min(100cqh, ${(template.height / template.width) * 100}cqw)`,
                 }}
               />
             </div>

             {/* Template Info */}
             <div className="flex-1 text-left">
               <div className="flex items-center gap-1.5">
                 <Icon
                   className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                     isSelected ? 'text-primary' : 'text-muted-foreground'
                   }`}
                 />
                 <h3 className="font-medium text-xs text-foreground group-hover:text-primary transition-colors truncate">
                   {template.name}
                 </h3>
               </div>
               <p className="text-[11px] text-muted-foreground mt-1">
                 {resolution}
                 <span className="mx-1">•</span>
                 {aspectRatio}
               </p>
             </div>
           </button>
         );
       })}
       {onSelectCustom && (
          <button
            type="button"
            aria-pressed={isCustomSelected}
            onClick={onSelectCustom}
            className={`group relative flex flex-col gap-2 p-3 panel-bg border rounded-lg transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 ${
              isCustomSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border'
            }`}
          >
           <div className="relative h-14 bg-secondary/30 rounded overflow-hidden flex items-center justify-center">
             <div
               className={`border-2 border-dashed rounded-sm transition-colors ${
                 isCustomSelected ? 'border-primary/70 bg-primary/10' : 'border-muted-foreground/30 bg-muted/10'
               }`}
               style={{ aspectRatio: '4 / 3', height: '80%', maxWidth: '80%' }}
             />
             <Plus
               className={`absolute w-4 h-4 transition-colors ${
                 isCustomSelected ? 'text-primary' : 'text-muted-foreground/60'
               }`}
             />
           </div>
           <div className="flex-1 text-left">
             <div className="flex items-center gap-1.5">
               <Monitor
                 className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                   isCustomSelected ? 'text-primary' : 'text-muted-foreground'
                 }`}
               />
               <h3 className={`font-medium text-xs transition-colors truncate ${
                 isCustomSelected ? 'text-primary' : 'text-foreground group-hover:text-primary'
               }`}>
                 Custom Size
               </h3>
             </div>
             <p className="text-[11px] text-muted-foreground mt-1">Enter dimensions</p>
           </div>
         </button>
       )}
    </div>
  );
}
