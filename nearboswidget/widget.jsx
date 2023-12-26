const [repositoryName, setRepositoryName] = useState("");
const [accountId, setAccountId] = useState("");

const permissionmap = {
    'none': 0x00,
    'owner': 0x01,
    'contributor': 0x02,
    'reader': 0x04
};

const [permission, setPermission] = useState(permissionmap['owner']);

function createRepository() {
    Near.call("wasmgit.near", "set_permission", {
        path: repositoryName,
        account_id: accountId,
        permission: parseInt(''+permission)
    },
        undefined
        , "100000000000000000000000"
    );
};
return (
    <>
        <h3>Set repository permission</h3>

        <h6>Repository name</h6>
        <input
            placeholder="Repository name"
            value={repositoryName}
            onInput={(e) => setRepositoryName(e.target.value)}
        ></input>

        <h6>Account id</h6>
        <input
            placeholder="Account id"
            value={accountId}
            onInput={(e) => setAccountId(e.target.value)}
        ></input>
        <h6>Permission</h6>
        <select value={permission} onChange={(e) => setPermission(e.target.value)}>
            {
                Object.keys(permissionmap).map(permissionName =>
                    <option value={permissionmap[permissionName]}>{permissionName}</option>
                )
            }
        </select>
        <br />
        <button onClick={createRepository}>Create</button>
    </>
);
