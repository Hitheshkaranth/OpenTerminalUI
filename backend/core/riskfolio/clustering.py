import numpy as np
import pandas as pd
import scipy.cluster.hierarchy as sch
import scipy.spatial.distance as ssd

def cluster_assets(returns, *, linkage_method: str = "ward", n_clusters: int | None = None) -> dict:
    """
    Hierarchical clustering of assets based on correlation.
    """
    symbols = returns.columns.tolist()
    n = len(symbols)
    
    if n < 2:
        return {
            "leaf_order": symbols,
            "groups": [{"id": 1, "symbols": symbols}] if n == 1 else [],
            "linkage": []
        }
    
    corr = returns.corr().values
    # Distance matrix: dist = sqrt((1-corr)/2)
    dist = np.sqrt(np.clip((1.0 - corr) / 2.0, 0.0, 1.0))
    
    # condensed distance matrix
    condensed = ssd.squareform(dist, checks=False)
    
    # Linkage
    link = sch.linkage(condensed, method=linkage_method)
    
    # Leaf order
    leaves = sch.leaves_list(link)
    leaf_order = [symbols[i] for i in leaves]
    
    # Number of clusters
    if n_clusters is None:
        if n >= 3:
            n_clusters = max(2, min(n - 1, int(round(np.sqrt(n)))))
        else:
            n_clusters = 1
    
    # Groups
    if n_clusters > 1:
        cluster_ids = sch.fcluster(link, t=n_clusters, criterion="maxclust")
        groups_dict = {}
        for i, cid in enumerate(cluster_ids):
            cid = int(cid)
            if cid not in groups_dict:
                groups_dict[cid] = []
            groups_dict[cid].append(symbols[i])
            
        # Sort symbols in each group by leaf_order
        groups = []
        for cid in sorted(groups_dict.keys()):
            # Reorder symbols in group to match leaf_order
            group_symbols = [s for s in leaf_order if s in groups_dict[cid]]
            groups.append({"id": cid, "symbols": group_symbols})
    else:
        groups = [{"id": 1, "symbols": leaf_order}]
        
    # Linkage rows: [int(a), int(b), float(dist), int(count)]
    linkage_json = []
    for row in link:
        linkage_json.append([int(row[0]), int(row[1]), float(row[2]), int(row[3])])
        
    return {
        "leaf_order": leaf_order,
        "groups": groups,
        "linkage": linkage_json
    }
