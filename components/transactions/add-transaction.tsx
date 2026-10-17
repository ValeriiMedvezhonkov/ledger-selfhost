"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { getTransactionOptions } from "@/app/actions/transaction-options";
import { getTransactionForEdit } from "@/app/actions/transaction-edit";
import {
  ComposeSheet,
  type ComposeInitial,
  type ComposeOptions,
} from "@/components/transactions/ios/compose-sheet";

interface AddTransaction {
  /** «Новая запись», from the «+» button. */
  readonly open: () => void;
  /** «Изменить» on an existing row. */
  readonly edit: (id: string) => void;
  /** True while the sheet is up. */
  readonly isOpen: boolean;
}

const Context = createContext<AddTransaction | null>(null);

/**
 * Lets anything in the app open the entry sheet — recording a purchase is the
 * thing this app is opened to do, so it never depends on where you stand.
 */
export function useAddTransaction(): AddTransaction {
  const value = useContext(Context);
  if (value === null) {
    throw new Error("useAddTransaction must be used inside AddTransactionProvider");
  }
  return value;
}


export function AddTransactionProvider({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const locale = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ComposeOptions | null>(null);
  const [initial, setInitial] = useState<ComposeInitial | null>(null);

  const load = useAction(getTransactionOptions, {
    onSuccess({ data }) {
      setOptions(data);
    },
  });
  const loadEdit = useAction(getTransactionForEdit, {
    onSuccess({ data }) {
      setInitial(data);
      setIsOpen(true);
    },
    onError({ error }) {
      toast.error(error.serverError ?? "");
    },
  });

  const ensureOptions = useCallback(() => {
    /*
     * Fetched on first open and then kept. Accounts and categories change
     * rarely; refetching on every open would put a spinner in front of the
     * form for something almost always identical to last time.
     */
    if (options === null && !load.isPending) load.execute({});
  }, [options, load]);

  const open = useCallback(() => {
    // Slides up from the bottom like every other sheet.
    ensureOptions();
    setInitial(null);
    setIsOpen(true);
  }, [ensureOptions]);

  const edit = useCallback(
    (id: string) => {
      ensureOptions();
      loadEdit.execute({ id, locale });
    },
    [ensureOptions, loadEdit, locale],
  );

  const value = useMemo(() => ({ open, edit, isOpen }), [open, edit, isOpen]);

  return (
    <Context.Provider value={value}>
      {children}
      <ComposeSheet
        open={isOpen}
        onOpenChange={setIsOpen}
        options={options}
        initial={initial}
        onSaved={() => {
          // The page underneath is showing figures this may have changed.
          router.refresh();
        }}
      />
    </Context.Provider>
  );
}
