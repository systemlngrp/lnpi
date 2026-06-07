import { useEffect, useState } from "react";
import { Item } from "../types";
import { fetchNpdItems } from "../lib/npdItems";

export function useNpdItems() {
  const [npdItems, setNpdItems] = useState<Item[]>([]);

  useEffect(() => {
    fetchNpdItems()
      .then(setNpdItems)
      .catch((error) => {
        console.error("Failed to fetch NPD items:", error);
        setNpdItems([]);
      });
  }, []);

  return npdItems;
}
