import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CircleAlert,
  Clapperboard,
  FileImage,
  Film,
  Info,
  LoaderCircle,
  Menu,
  MonitorPlay,
  OctagonX,
  Play,
  RefreshCw,
  Scissors,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  getGetAvatarVideoTaskQueryKey,
  getGetStudioStatusQueryKey,
  useGenerateAvatarVideo,
  useGetAvatarVideoTask,
  useGetStudioStatus,
  useStopAvatarVideoTask,
  type AvatarVideoInput,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

const queryClient = new QueryClient();

type Format = AvatarVideoInput['format'];
type AudioSource = AvatarVideoInput['audioSource'];
type AudioVoice = AvatarVideoInput['audioVoice'];
type VideoDuration = NonNullable<AvatarVideoInput['videoDuration']>;
type SceneCount = NonNullable<AvatarVideoInput['sceneCount']>;

const voiceOptions: { value: AudioVoice; label: string; hint: string }[] = [
  { value: 'fr-FR-DeniseNeural', label: 'Denise', hint: 'Français · voix féminine' },
  { value: 'fr-FR-HenriNeural', label: 'Henri', hint: 'Français · voix masculine' },
  { value: 'fr-FR-EloiseNeural', label: 'Éloïse', hint: 'Français · voix féminine' },
  { value: 'fr-FR-BrigitteNeural', label: 'Brigitte', hint: 'Français · voix féminine' },
];

const formatOptions: { value: Format; label: string; hint: string }[] = [
  { value: '16:9', label: 'Paysage', hint: 'YouTube, site' },
  { value: '9:16', label: 'Portrait', hint: 'Reels, TikTok' },
  { value: '1:1', label: 'Carré', hint: 'Flux sociaux' },
];

const durationOptions: { value: VideoDuration; label: string }[] = [
  { value: 15, label: '15 s' },
  { value: 30, label: '30 s' },
  { value: 45, label: '45 s' },
  { value: 60, label: '60 s' },
];

const steps = [
  { number: '01', label: 'Portrait', caption: 'Votre point de départ' },
  { number: '02', label: 'Script', caption: 'Votre intention' },
  { number: '03', label: 'Rendu', caption: 'Agnes en action' },
];

function StudioMark() {
  return (
    <div className="flex items-center gap-3" data-testid="brand-studio">
      <div className="relative flex h-10 w-10 items-center justify-center bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]">
        <Clapperboard className="h-5 w-5" strokeWidth={2.4} />
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[hsl(var(--sidebar))] bg-[hsl(var(--destructive))]" />
      </div>
      <div className="leading-none">
        <p className="font-display text-[15px] font-bold tracking-[-0.03em] text-[hsl(var(--sidebar-foreground))]">Atelier</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--sidebar-foreground)/.55)]">Avatar IA</p>
      </div>
    </div>
  );
}

function StudioRail({ mobile = false, onClose }: { mobile?: boolean; onClose?: () => void }) {
  return (
    <aside className={`${mobile ? 'fixed inset-y-0 left-0 z-50 w-[280px]' : 'hidden lg:flex lg:w-[264px]'} flex-col bg-[hsl(var(--sidebar))] px-6 py-7 text-[hsl(var(--sidebar-foreground))]`}>
      <div className="flex items-center justify-between">
        <StudioMark />
        {mobile ? (
          <button type="button" onClick={onClose} aria-label="Fermer le menu" className="rounded-lg p-2 text-[hsl(var(--sidebar-foreground)/.65)] hover:bg-white/10" data-testid="button-close-menu">
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      <div className="mt-16">
        <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[hsl(var(--sidebar-foreground)/.42)]">Studio / 001</p>
        <div className="mt-5 space-y-2">
          {steps.map((step, index) => (
            <div key={step.number} className={`relative flex gap-3 rounded-xl px-3 py-3 ${index === 0 ? 'bg-white/[.08]' : ''}`} data-testid={`step-${index + 1}`}>
              <span className={`font-mono text-[11px] ${index === 0 ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--sidebar-foreground)/.42)]'}`}>{step.number}</span>
              <div>
                <p className="text-sm font-semibold">{step.label}</p>
                <p className="mt-0.5 text-[11px] text-[hsl(var(--sidebar-foreground)/.46)]">{step.caption}</p>
              </div>
              {index < steps.length - 1 ? <span className="absolute bottom-[-10px] left-[23px] h-2 w-px bg-[hsl(var(--sidebar-foreground)/.2)]" /> : null}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-auto">
        <div className="border-t border-[hsl(var(--sidebar-border))] pt-5">
          <div className="flex items-start gap-3 text-[hsl(var(--sidebar-foreground)/.6)]">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--accent))]" />
            <p className="text-[11px] leading-[1.6]">Un portrait, un texte. Agnes anime l’avatar et prépare la voix.</p>
          </div>
          <p className="mt-6 font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.3)]">Pas de compte requis</p>
        </div>
      </div>
    </aside>
  );
}

function StatusPill({ configured, loading }: { configured?: boolean; loading?: boolean }) {
  if (loading) {
    return <span className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))]" data-testid="status-engine-loading"><LoaderCircle className="h-3 w-3 animate-spin" /> Vérification</span>;
  }
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.13em] ${configured ? 'border-[hsl(var(--accent)/.55)] bg-[hsl(var(--accent)/.15)] text-[hsl(var(--foreground))]' : 'border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--destructive)/.09)] text-[hsl(var(--destructive))]'}`} data-testid="status-engine">
      <span className={`h-1.5 w-1.5 rounded-full ${configured ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--destructive))]'}`} />
      Agnes {configured ? 'opérationnel' : 'indisponible'}
    </span>
  );
}

function readImageFile(file: File | undefined, onImage: (value: string) => void, onError: (value: string) => void) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    onError('Choisissez une image PNG, JPEG ou WebP.');
    return;
  }
  if (file.size > 9 * 1024 * 1024) {
    onError('Cette image dépasse 9 Mo. Choisissez un fichier plus léger.');
    return;
  }
  onError('');
  const reader = new FileReader();
  reader.onload = () => onImage(String(reader.result));
  reader.readAsDataURL(file);
}

function UploadField({ image, onImage }: { image: string; onImage: (value: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    readImageFile(event.dataTransfer.files[0], onImage, setUploadError);
  };

  return (
    <div>
      <div
        className={`group relative min-h-[238px] cursor-pointer overflow-hidden rounded-[20px] border border-dashed transition-colors ${dragging ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/.15)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--muted)/.42)] hover:border-[hsl(var(--foreground)/.48)]'} ${image ? 'p-2' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        data-testid="upload-avatar"
      >
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event: ChangeEvent<HTMLInputElement>) => readImageFile(event.target.files?.[0], onImage, setUploadError)} data-testid="input-avatar-file" />
        {image ? (
          <div className="relative h-[222px] overflow-hidden rounded-[14px] bg-[hsl(var(--foreground))]">
            <img src={image} alt="Aperçu du portrait téléversé" className="h-full w-full object-cover" data-testid="img-avatar-preview" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8">
              <span className="font-mono text-[10px] uppercase tracking-[.12em] text-white">Portrait chargé</span>
              <span className="rounded-md bg-white/15 px-2 py-1 text-[10px] font-semibold text-white">Remplacer</span>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[238px] flex-col items-center justify-center px-5 text-center">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-editorial-sm">
              <FileImage className="h-6 w-6" strokeWidth={1.6} />
            </div>
            <p className="text-sm font-bold">Déposez votre portrait ici</p>
            <p className="mt-2 max-w-[230px] text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">ou cliquez pour choisir un fichier PNG, JPEG ou WebP</p>
            <span className="mt-5 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--foreground)/.62)]"><Upload className="h-3.5 w-3.5" /> 9 Mo maximum</span>
          </div>
        )}
      </div>
      {uploadError ? <p className="mt-2 flex items-center gap-2 text-xs font-medium text-[hsl(var(--destructive))]" data-testid="error-avatar-upload"><CircleAlert className="h-3.5 w-3.5" />{uploadError}</p> : null}
    </div>
  );
}

function AdditionalPhotosField({ images, onImages, onMakeAvatar, maxImages }: {
  images: string[];
  onImages: (images: string[]) => void;
  onMakeAvatar: (index: number) => void;
  maxImages: number;
}) {
  const [uploadError, setUploadError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const remaining = maxImages - images.length;
    if (remaining <= 0) {
      setUploadError(`Vous pouvez ajouter jusqu’à ${maxImages} photo${maxImages > 1 ? 's' : ''} de décor.`);
      return;
    }
    const selected = Array.from(files).slice(0, remaining);
    let loaded = 0;
    const next: string[] = [];
    for (const file of selected) {
      readImageFile(file, (value) => {
        next.push(value);
        loaded += 1;
        if (loaded === selected.length) onImages([...images, ...next]);
      }, setUploadError);
    }
  };

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
           <p className="text-sm font-bold">Photos de décor <span className="font-normal text-[hsl(var(--muted-foreground))]">(facultatif)</span></p>
            <p className="mt-1 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">Une photo peut guider chaque plan. Jusqu’à {maxImages} décor{maxImages > 1 ? 's' : ''} selon le nombre de scènes choisi.</p>
        </div>
        <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-bold hover:border-[hsl(var(--foreground)/.5)]" data-testid="button-add-scene-photos"><Upload className="h-3.5 w-3.5" /> Ajouter</button>
      </div>
      <input ref={inputRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = ''; }} data-testid="input-scene-files" />
      {images.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((image, index) => (
            <div key={`${image.slice(0, 30)}-${index}`} className="group relative overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
              <img src={image} alt={`Référence de scène ${index + 1}`} className="aspect-[4/3] w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-6">
                <button type="button" onClick={() => onMakeAvatar(index)} className="rounded bg-white/90 px-2 py-1 text-[10px] font-bold text-black" data-testid={`button-make-avatar-${index}`}>Choisir avatar</button>
                <button type="button" onClick={() => onImages(images.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Supprimer la photo ${index + 1}`} className="rounded bg-black/50 px-2 py-1 text-[10px] font-bold text-white" data-testid={`button-remove-scene-${index}`}>Retirer</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {uploadError ? <p className="mt-2 flex items-center gap-2 text-xs font-medium text-[hsl(var(--destructive))]" data-testid="error-scene-upload"><CircleAlert className="h-3.5 w-3.5" />{uploadError}</p> : null}
    </div>
  );
}

function FormatSelector({ value, onChange }: { value: Format; onChange: (value: Format) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Format de sortie">
      {formatOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-xl border px-2 py-3 text-left transition-colors ${value === option.value ? 'border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] text-[hsl(var(--background))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--foreground)/.48)]'}`}
          data-testid={`button-format-${option.value.replace(':', '-')}`}
        >
          <span className="block font-mono text-[12px] font-medium">{option.value}</span>
          <span className={`mt-1 block text-[10px] ${value === option.value ? 'text-[hsl(var(--background)/.65)]' : 'text-[hsl(var(--muted-foreground))]'}`}>{option.hint}</span>
        </button>
      ))}
    </div>
  );
}

function TaskPanel({ taskId, onReset }: { taskId: string; onReset: () => void }) {
  const queryClient = useQueryClient();
  const taskQuery = useGetAvatarVideoTask(taskId, {
    query: {
      enabled: Boolean(taskId),
      queryKey: getGetAvatarVideoTaskQueryKey(taskId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'completed' || status === 'failed' || status === 'stopped' ? false : 1800;
      },
    },
  });
  const stopTask = useStopAvatarVideoTask();
  const task = taskQuery.data;
  const isActive = task?.status === 'queued' || task?.status === 'running' || !task;
  const progress = Math.max(0, Math.min(1, task?.progress ?? 0));

  const stop = () => {
    stopTask.mutate({ taskId }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getGetAvatarVideoTaskQueryKey(taskId) });
        await queryClient.refetchQueries({ queryKey: getGetAvatarVideoTaskQueryKey(taskId) });
      },
    });
  };

  if (taskQuery.isError) {
    return (
      <section className="animate-rise rounded-[24px] border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)] p-6 md:p-8" data-testid="task-error">
        <CircleAlert className="h-6 w-6 text-[hsl(var(--destructive))]" />
        <h2 className="mt-5 font-display text-2xl font-bold">Le suivi n’est pas disponible</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Le rendu a peut-être démarré, mais nous ne pouvons pas lire son état pour le moment.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => taskQuery.refetch()} className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-3 text-sm font-bold text-[hsl(var(--background))]" data-testid="button-retry-task"><RefreshCw className="h-4 w-4" /> Réessayer</button>
          <button type="button" onClick={onReset} className="rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-bold" data-testid="button-new-from-task-error">Revenir au studio</button>
        </div>
      </section>
    );
  }

  return (
    <section className="animate-rise overflow-hidden rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-editorial" data-testid="task-panel">
      <div className="border-b border-[hsl(var(--border))] px-6 py-5 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Projet en cours</p>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-[-.03em]" data-testid="text-task-title">
              {task?.status === 'completed' ? 'Votre vidéo est prête.' : task?.status === 'failed' ? 'Le rendu a rencontré un blocage.' : task?.status === 'stopped' ? 'Rendu arrêté.' : 'Agnes compose votre vidéo.'}
            </h2>
          </div>
          <span className={`rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.12em] ${task?.status === 'completed' ? 'bg-[hsl(var(--accent)/.18)] text-[hsl(var(--foreground))]' : task?.status === 'failed' ? 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`} data-testid="status-task">{task?.status === 'queued' ? 'En file' : task?.status === 'running' ? 'En cours' : task?.status === 'completed' ? 'Terminé' : task?.status === 'failed' ? 'Échec' : task?.status === 'stopped' ? 'Arrêté' : 'Connexion'}</span>
        </div>
        <p className="mt-3 font-mono text-[10px] text-[hsl(var(--muted-foreground))]" data-testid="text-task-id">ID {taskId}</p>
      </div>

      {task?.status === 'completed' && task.videoUrl ? (
        <div className="p-4 md:p-8">
          <div className="group relative overflow-hidden rounded-[18px] bg-[hsl(var(--foreground))]">
            <video controls playsInline src={task.videoUrl} className="max-h-[560px] w-full" data-testid="video-result">
              Votre navigateur ne peut pas lire cette vidéo.
            </video>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-[hsl(var(--accent-foreground))] rounded-full bg-[hsl(var(--accent))] p-0.5" /> Fichier final disponible</div>
            <div className="flex flex-wrap gap-2">
              <a href={task.videoUrl} download className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-3 text-sm font-bold text-[hsl(var(--background))] hover:opacity-90" data-testid="link-download-video"><ArrowDownToLine className="h-4 w-4" /> Télécharger</a>
              <button type="button" onClick={onReset} className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-bold" data-testid="button-new-video"><Sparkles className="h-4 w-4" /> Nouveau rendu</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-6 md:p-8">
          {task?.status === 'failed' || task?.status === 'stopped' ? (
            <div className={`rounded-2xl p-5 ${task.status === 'failed' ? 'bg-[hsl(var(--destructive)/.07)]' : 'bg-[hsl(var(--muted))]'}`} data-testid="task-final-message">
              <div className="flex items-start gap-3">
                {task.status === 'failed' ? <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--destructive))]" /> : <OctagonX className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--muted-foreground))]" />}
                <div>
                  <p className="text-sm font-bold">{task.status === 'failed' ? 'Le rendu n’a pas abouti.' : 'Le rendu a été arrêté.'}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{task.error || (task.status === 'failed' ? 'Agnes n’a pas pu terminer ce rendu. Vérifiez votre portrait et réessayez.' : 'Aucun fichier vidéo n’a été produit.')}</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-end justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]" data-testid="text-task-step">{task?.step || 'Préparation du rendu'}</span>
                <span className="font-mono text-2xl font-medium tabular-nums" data-testid="text-task-progress">{Math.round(progress * 100)}%</span>
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-[hsl(var(--muted))]" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} data-testid="progress-task">
                <div className="h-full rounded-full bg-[hsl(var(--accent))] transition-[width] duration-700" style={{ width: `${Math.max(progress * 100, 4)}%` }} />
              </div>
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {['Lecture du script', 'Préparation du portrait', 'Animation Agnes'].map((label, index) => (
                  <div key={label} className={`rounded-xl border p-3 ${index < Math.ceil(progress * 3) ? 'border-[hsl(var(--accent)/.4)] bg-[hsl(var(--accent)/.08)]' : 'border-[hsl(var(--border))]'}`}>
                    <div className="flex items-center gap-2">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full font-mono text-[9px] ${index < Math.ceil(progress * 3) ? 'bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>{index < Math.ceil(progress * 3) ? <Check className="h-3 w-3" /> : index + 1}</span>
                      <span className="text-[11px] font-semibold">{label}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-7 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">La qualité du mouvement dépend du modèle vidéo Agnes. Le temps de rendu varie selon la longueur du script et le traitement du modèle.</p>
              {isActive ? <button type="button" onClick={stop} disabled={stopTask.isPending} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--destructive)/.35)] px-4 py-3 text-sm font-bold text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.07)] disabled:cursor-wait disabled:opacity-50" data-testid="button-stop-task">{stopTask.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <OctagonX className="h-4 w-4" />} Arrêter le rendu</button> : null}
            </>
          )}
          {!isActive && task?.status !== 'completed' ? <button type="button" onClick={onReset} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-3 text-sm font-bold text-[hsl(var(--background))]" data-testid="button-retry-video"><RefreshCw className="h-4 w-4" /> Revenir au studio</button> : null}
        </div>
      )}
    </section>
  );
}

const currentTaskStorageKey = 'atelier-avatar-current-task';

function readCurrentTaskId(): string {
  try {
    const savedTaskId = window.localStorage.getItem(currentTaskStorageKey);
    return savedTaskId && /^[A-Za-z0-9_-]{1,64}$/.test(savedTaskId) ? savedTaskId : '';
  } catch {
    return '';
  }
}

function persistCurrentTaskId(taskId: string | null): void {
  try {
    if (taskId) window.localStorage.setItem(currentTaskStorageKey, taskId);
    else window.localStorage.removeItem(currentTaskStorageKey);
  } catch {
    // The task still works in memory when browser storage is unavailable.
  }
}

function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarImageDataUrl, setAvatarImageDataUrl] = useState('');
  const [sceneImageDataUrls, setSceneImageDataUrls] = useState<string[]>([]);
  const [scriptText, setScriptText] = useState('');
  const [sceneDirection, setSceneDirection] = useState('');
  const [format, setFormat] = useState<Format>('16:9');
  const [audioSource, setAudioSource] = useState<AudioSource>('model');
  const [audioVoice, setAudioVoice] = useState<AudioVoice>('fr-FR-DeniseNeural');
  const [agnesApiKey, setAgnesApiKey] = useState('');
  const [videoDuration, setVideoDuration] = useState<VideoDuration>(15);
  const [sceneCount, setSceneCount] = useState<SceneCount>(1);
  const [taskId, setTaskId] = useState(readCurrentTaskId);
  const [formError, setFormError] = useState('');
  const queryClient = useQueryClient();
  const statusQuery = useGetStudioStatus({ query: { queryKey: getGetStudioStatusQueryKey(), staleTime: 30_000 } });
  const generateVideo = useGenerateAvatarVideo();

  useEffect(() => {
    if (taskId) document.getElementById('suivi')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [taskId]);

  useEffect(() => {
    setSceneImageDataUrls((current) => current.slice(0, sceneCount));
  }, [sceneCount]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    if (!statusQuery.data?.configured && !agnesApiKey.trim()) {
      setFormError(statusQuery.data?.message || 'Le moteur Agnes n’est pas disponible pour le moment.');
      return;
    }
    if (!avatarImageDataUrl) {
      setFormError('Ajoutez un portrait avant de lancer le rendu.');
      return;
    }
    if (!scriptText.trim()) {
      setFormError('Écrivez un script avant de lancer le rendu.');
      return;
    }
    if (scriptText.length > 16_000) {
      setFormError('Votre script dépasse 16 000 caractères.');
      return;
    }
    const input: AvatarVideoInput = {
      avatarImageDataUrl,
      sceneImageDataUrls: sceneImageDataUrls.length ? sceneImageDataUrls : undefined,
      agnesApiKey: agnesApiKey.trim() || undefined,
      scriptText: scriptText.trim(),
      sceneDirection: sceneDirection.trim() || undefined,
      format,
      audioSource,
      audioVoice,
      videoDuration,
      sceneCount,
    };
    generateVideo.mutate({ data: input }, {
      onSuccess: async (created) => {
        setTaskId(created.taskId);
        persistCurrentTaskId(created.taskId);
        await queryClient.invalidateQueries({ queryKey: getGetStudioStatusQueryKey() });
      },
      onError: (error) => {
        setFormError(error instanceof Error ? error.message : 'Impossible de lancer le rendu. Réessayez dans un instant.');
      },
    });
  };

  const reset = () => {
    setTaskId('');
    persistCurrentTaskId(null);
    setFormError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const characterCount = scriptText.length;
  const unavailable = statusQuery.data && !statusQuery.data.configured && !agnesApiKey.trim();

  return (
    <div className="grain min-h-[100dvh] bg-[hsl(var(--background))]">
      {menuOpen ? <StudioRail mobile onClose={() => setMenuOpen(false)} /> : null}
      <div className="flex min-h-[100dvh]">
        <StudioRail />
        <main className="min-w-0 flex-1">
          <header className="flex h-[76px] items-center justify-between border-b border-[hsl(var(--border))] px-5 md:px-10">
            <button type="button" onClick={() => setMenuOpen(true)} className="rounded-lg p-2 lg:hidden" aria-label="Ouvrir le menu" data-testid="button-open-menu"><Menu className="h-5 w-5" /></button>
            <div className="hidden items-center gap-2 lg:flex" data-testid="breadcrumb-studio"><span className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Atelier</span><ArrowRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]" /><span className="font-mono text-[10px] uppercase tracking-[.16em]">Nouveau projet</span></div>
            <div className="ml-auto flex items-center gap-3"><StatusPill configured={statusQuery.data?.configured} loading={statusQuery.isLoading} /><span className="hidden font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] sm:inline">Session locale</span></div>
          </header>

          <div className="mx-auto max-w-[1240px] px-5 pb-20 pt-10 md:px-10 md:pt-14">
            <section className="relative max-w-[760px] animate-rise" aria-labelledby="page-title">
              <div className="absolute -left-5 top-1 h-12 w-1 bg-[hsl(var(--accent))] md:-left-10" />
              <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[hsl(var(--muted-foreground))]">Studio de création vidéo / 001</p>
              <h1 id="page-title" className="mt-5 font-display text-[clamp(2.6rem,6vw,5.8rem)] font-bold leading-[.94] tracking-[-.075em]">Donnez une voix<br /><span className="text-[hsl(var(--destructive))]">à votre avatar.</span></h1>
              <p className="mt-7 max-w-[520px] text-base leading-[1.7] text-[hsl(var(--muted-foreground))] md:text-lg">Un portrait. Un script. Une vidéo d’avatar prête à partager — sans compte, sans détour.</p>
            </section>

            {unavailable ? <div className="mt-10 flex max-w-[920px] items-start gap-3 rounded-2xl border border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--destructive)/.07)] p-4 text-sm" data-testid="banner-engine-unavailable"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--destructive))]" /><div><p className="font-bold">Le moteur Agnes n’est pas prêt.</p><p className="mt-1 text-[hsl(var(--muted-foreground))]">{statusQuery.data?.message || 'Le studio ne peut pas lancer de rendu actuellement.'}</p></div></div> : null}
            {statusQuery.isError ? <div className="mt-10 flex max-w-[920px] items-center justify-between gap-4 rounded-2xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)] p-4 text-sm" data-testid="banner-status-error"><span className="flex items-center gap-3"><CircleAlert className="h-4 w-4 text-[hsl(var(--destructive))]" /> Impossible de vérifier Agnes.</span><button type="button" onClick={() => statusQuery.refetch()} className="inline-flex items-center gap-2 font-bold" data-testid="button-retry-status"><RefreshCw className="h-3.5 w-3.5" /> Réessayer</button></div> : null}

            {!taskId ? (
              <form onSubmit={submit} className="mt-14 grid max-w-[1120px] gap-6 lg:grid-cols-[minmax(0,1.22fr)_minmax(300px,.78fr)]" data-testid="form-create-video">
                <div className="space-y-6">
                  <section className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-editorial-sm md:p-8" data-testid="section-portrait">
                    <div className="mb-6 flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Étape 01</p><h2 className="mt-2 font-display text-2xl font-bold tracking-[-.04em]">Choisissez le visage</h2></div><FileImage className="h-5 w-5 text-[hsl(var(--muted-foreground))]" /></div>
                    <UploadField image={avatarImageDataUrl} onImage={setAvatarImageDataUrl} />
                    <AdditionalPhotosField
                      images={sceneImageDataUrls}
                      onImages={setSceneImageDataUrls}
                      maxImages={Math.min(sceneCount, 2)}
                      onMakeAvatar={(index) => {
                        const selected = sceneImageDataUrls[index];
                        setSceneImageDataUrls(sceneImageDataUrls.filter((_, itemIndex) => itemIndex !== index));
                        if (avatarImageDataUrl) setSceneImageDataUrls((current) => [...current, avatarImageDataUrl]);
                        setAvatarImageDataUrl(selected);
                      }}
                    />
                  </section>
                  <section className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-editorial-sm md:p-8" data-testid="section-script">
                    <div className="mb-6 flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Étape 02</p><h2 className="mt-2 font-display text-2xl font-bold tracking-[-.04em]">Écrivez le script</h2></div><Scissors className="h-5 w-5 text-[hsl(var(--muted-foreground))]" /></div>
                    <label htmlFor="script" className="text-sm font-bold">Script de la vidéo <span className="font-normal text-[hsl(var(--muted-foreground))]">(obligatoire)</span></label>
                    <textarea id="script" value={scriptText} onChange={(event) => setScriptText(event.target.value)} placeholder="Présentez votre idée en quelques phrases..." rows={7} maxLength={16000} className="mt-3 w-full resize-y rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-4 py-4 text-sm leading-relaxed placeholder:text-[hsl(var(--muted-foreground)/.7)] focus:border-[hsl(var(--foreground))] focus:outline-none" data-testid="textarea-script" />
                    <div className="mt-2 flex justify-between gap-3"><p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">Agnes transforme ce script en parole pour l’avatar.</p><span className="shrink-0 font-mono text-[10px] text-[hsl(var(--muted-foreground))]" data-testid="text-script-count">{characterCount.toLocaleString('fr-FR')} / 16 000</span></div>
                    <label htmlFor="direction" className="mt-7 block text-sm font-bold">Direction du plan <span className="font-normal text-[hsl(var(--muted-foreground))]">(facultatif)</span></label>
                    <textarea id="direction" value={sceneDirection} onChange={(event) => setSceneDirection(event.target.value)} placeholder="Ex. lumière douce, regard caméra, ton complice..." rows={3} maxLength={1800} className="mt-3 w-full resize-y rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-4 py-3 text-sm leading-relaxed placeholder:text-[hsl(var(--muted-foreground)/.7)] focus:border-[hsl(var(--foreground))] focus:outline-none" data-testid="textarea-direction" />
                     <p className="mt-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">Les photos supplémentaires guident le décor et l’arrière-plan, tandis que le portrait reste l’identité principale de l’avatar.</p>
                  </section>
                </div>
                <div className="space-y-6">
                  <section className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-editorial-sm md:p-7" data-testid="section-settings">
                    <div className="mb-6"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Étape 03</p><h2 className="mt-2 font-display text-2xl font-bold tracking-[-.04em]">Cadrez le rendu</h2></div>
                    <label className="text-sm font-bold">Format</label>
                    <div className="mt-3"><FormatSelector value={format} onChange={setFormat} /></div>
                     <label className="mt-7 block text-sm font-bold">Durée finale</label>
                     <div className="mt-3 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Durée finale">
                       {durationOptions.map((option) => (
                         <button type="button" key={option.value} role="radio" aria-checked={videoDuration === option.value} onClick={() => setVideoDuration(option.value)} className={`rounded-xl border px-2 py-3 text-center text-sm font-bold transition-colors ${videoDuration === option.value ? 'border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] text-[hsl(var(--background))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--foreground)/.48)]'}`} data-testid={`button-duration-${option.value}`}>{option.label}</button>
                       ))}
                     </div>
                     <p className="mt-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">Agnes génère des clips de 15 secondes, puis le studio les assemble jusqu’à la durée choisie.</p>
                     <label className="mt-6 block text-sm font-bold">Nombre de scènes</label>
                     <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Nombre de scènes">
                       {([1, 2, 3] as SceneCount[]).map((value) => (
                         <button type="button" key={value} role="radio" aria-checked={sceneCount === value} onClick={() => setSceneCount(value)} className={`rounded-xl border px-2 py-3 text-center text-sm font-bold transition-colors ${sceneCount === value ? 'border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] text-[hsl(var(--background))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--foreground)/.48)]'}`} data-testid={`button-scene-count-${value}`}>{value} scène{value > 1 ? 's' : ''}</button>
                       ))}
                     </div>
                     <p className="mt-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">Chaque scène devient un plan vidéo distinct. Les photos de décor sont associées dans le même ordre.</p>
                     <label htmlFor="agnes-api-key" className="mt-7 block text-sm font-bold">Clé API Agnes <span className="font-normal text-[hsl(var(--muted-foreground))]">(facultatif)</span></label>
                     <input id="agnes-api-key" type="password" value={agnesApiKey} onChange={(event) => setAgnesApiKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Utiliser la clé du serveur par défaut" className="mt-3 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-3 py-3 text-sm focus:border-[hsl(var(--foreground))] focus:outline-none" data-testid="input-agnes-api-key" />
                     <p className="mt-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">Cette clé est transmise uniquement à ce rendu. Elle n’est pas enregistrée dans le navigateur, la tâche ou les journaux.</p>
                    <label className="mt-7 block text-sm font-bold">Audio</label>
                    <div className="mt-3 space-y-2">
                      <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 ${audioSource === 'model' ? 'border-[hsl(var(--foreground))] bg-[hsl(var(--muted)/.62)]' : 'border-[hsl(var(--border))]'}`}><input type="radio" name="audio" value="model" checked={audioSource === 'model'} onChange={() => setAudioSource('model')} className="mt-0.5 accent-[hsl(var(--foreground))]" data-testid="radio-audio-model" /><span><span className="block text-sm font-semibold">Voix générée avec la vidéo</span><span className="mt-1 block text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">Agnes produit la parole dans le plan animé; la synchronisation dépend du modèle.</span></span></label>
                      <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 ${audioSource === 'post_stitch' ? 'border-[hsl(var(--foreground))] bg-[hsl(var(--muted)/.62)]' : 'border-[hsl(var(--border))]'}`}><input type="radio" name="audio" value="post_stitch" checked={audioSource === 'post_stitch'} onChange={() => setAudioSource('post_stitch')} className="mt-0.5 accent-[hsl(var(--foreground))]" data-testid="radio-audio-post-stitch" /><span><span className="block text-sm font-semibold">Voix off ajoutée après l’animation</span><span className="mt-1 block text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">La voix est assemblée au clip après le rendu.</span></span></label>
                    </div>
                    <label htmlFor="voice" className="mt-6 block text-sm font-bold">Voix</label>
                    <select id="voice" value={audioVoice} onChange={(event) => setAudioVoice(event.target.value as AudioVoice)} className="mt-3 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-3 py-3 text-sm focus:border-[hsl(var(--foreground))] focus:outline-none" data-testid="select-audio-voice">
                      {voiceOptions.map((voice) => <option key={voice.value} value={voice.value}>{voice.label} — {voice.hint}</option>)}
                    </select>
                    <div className="mt-7 border-t border-[hsl(var(--border))] pt-5"><div className="flex items-start gap-3"><Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" /><p className="text-[11px] leading-[1.65] text-[hsl(var(--muted-foreground))]">Le résultat final et la qualité des mouvements dépendent du modèle Agnes. Un portrait net, bien éclairé, donne de meilleurs résultats.</p></div></div>
                    {formError ? <div className="mt-5 flex items-start gap-2 rounded-xl bg-[hsl(var(--destructive)/.08)] p-3 text-xs font-medium leading-relaxed text-[hsl(var(--destructive))]" data-testid="error-create-video"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{formError}</div> : null}
                    <button type="submit" disabled={generateVideo.isPending || statusQuery.isLoading || unavailable === true} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-5 py-4 text-sm font-bold text-[hsl(var(--background))] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-generate-video">{generateVideo.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Préparation du rendu...</> : <><Play className="h-4 w-4 fill-current" /> Lancer le rendu</>}</button>
                  </section>
                  <div className="flex items-start gap-3 px-2 text-[11px] leading-[1.6] text-[hsl(var(--muted-foreground))]"><MonitorPlay className="mt-0.5 h-4 w-4 shrink-0" /><p>Vous pouvez suivre la progression et arrêter la tâche à tout moment.</p></div>
                </div>
              </form>
            ) : (
              <div id="suivi" className="mt-14 max-w-[920px]"><TaskPanel taskId={taskId} onReset={reset} /></div>
            )}
          </div>
          <footer className="border-t border-[hsl(var(--border))] px-5 py-7 md:px-10"><div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3"><p className="font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Atelier Avatar IA — studio pratique pour créateurs</p><p className="text-[11px] text-[hsl(var(--muted-foreground))]">Moteur vidéo : Agnes</p></div></footer>
        </main>
      </div>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;