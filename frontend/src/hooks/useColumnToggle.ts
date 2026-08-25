import { useState, useCallback } from "react";
export function useColumnToggle(defaultCols: string[]) {
  const [visible, setVisible] = useState<string[]>(defaultCols);
  const toggle = useCallback((col: string) => {
    setVisible(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  }, []);
  return { visibleColumns: visible, toggleColumn: toggle };
}
