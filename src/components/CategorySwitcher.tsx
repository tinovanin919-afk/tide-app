import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStore } from "@/lib/store";

export function CategorySwitcher() {
  const { state, dispatch } = useStore();
  return (
    <Tabs value={state.category} onValueChange={(value) => dispatch({ type: "setCategory", value: value === "vita" ? "vita" : "scuola" })}>
      <TabsList aria-label="Ambito" className="h-11 w-full max-w-sm border border-glass-border bg-secondary">
        <TabsTrigger value="scuola" className="flex-1 py-2 data-[state=active]:bg-accent">Scuola 📚</TabsTrigger>
        <TabsTrigger value="vita" className="flex-1 py-2 data-[state=active]:bg-accent">Vita Quotidiana 🏠</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}