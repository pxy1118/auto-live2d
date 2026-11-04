"""Small adapter to LMFE's public core, compatible with Transformers 5 tokenizers."""
def tokenizer_data(tokenizer, eos):
    from lmformatenforcer import TokenEnforcerTokenizerData
    prefix = tokenizer.encode('0', add_special_tokens=False)[-1]
    special = set(tokenizer.all_special_ids)
    regular = []
    for token in range(len(tokenizer)):
        if token in special:
            continue
        standalone = tokenizer.decode([token], clean_up_tokenization_spaces=False)
        after = tokenizer.decode([prefix, token], clean_up_tokenization_spaces=False)[1:]
        regular.append((token, after, len(after) > len(standalone)))
    return TokenEnforcerTokenizerData(regular,
        lambda ids: tokenizer.decode(ids, clean_up_tokenization_spaces=False).rstrip('�'),
        eos, False, len(tokenizer))


def schema_enforcer(data, schema):
    from lmformatenforcer import JsonSchemaParser, TokenEnforcer, CharacterLevelParserConfig
    # The string minLength parser caches its alphabet at construction. Supply
    # the tokenizer's Unicode alphabet then, rather than relying on a later setter.
    parser = JsonSchemaParser(schema, CharacterLevelParserConfig(alphabet=data.tokenizer_alphabet))
    return TokenEnforcer(data, parser)
