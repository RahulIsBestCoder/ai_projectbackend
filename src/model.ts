/**
 * Base data-access class (plan §5.5 / §16.2). Generic Mongoose repository.
 * Domain models `extend Model` and call `super('<collection>', schemaDef, opts)`.
 */
export class Model {
  public schema: any;
  public Model: any;

  constructor(name: string, schema: Record<string, unknown>, schemaOptions: Record<string, unknown> = {}) {
    this.schema = new global.db.Schema(schema, schemaOptions);
    // Reuse an already-registered model to stay safe under eager re-instantiation.
    this.Model = global.db.models[name] || global.db.model(name, this.schema);
  }

  public addNewRecord(obj: any) {
    return this.Model.create(obj);
  }

  public addBulkRecord(arr: any[]) {
    return this.Model.insertMany(arr);
  }

  public findByAny(filter: any, projection: any = {}) {
    return this.Model.findOne(filter, projection);
  }

  public findAllByAny(filter: any, attrs: any = '') {
    return this.Model.find(filter).select(attrs).exec();
  }

  public findSelectiveByAny({ data, attributes, offset, limit, sort }: any) {
    return this.Model.find(data)
      .select(attributes)
      .skip(offset)
      .limit(limit)
      .sort(sort);
  }

  public countSelectiveByAny({ data }: any) {
    return this.Model.find(data).countDocuments();
  }

  public countAllByAny(filter: any) {
    return this.Model.find(filter).countDocuments();
  }

  public updateAnyRecord(filter: any, update: any) {
    // NOTE (plan §16.6): this is `updateMany` by design — keep filters `_id`-scoped.
    return this.Model.updateMany(filter, update);
  }

  public deleteMany(filter: any) {
    return this.Model.deleteMany(filter);
  }

  public deleteOne(filter: any) {
    return this.Model.deleteOne(filter);
  }

  public countAllByFilter(filter: any) {
    return this.Model.countDocuments(filter);
  }
}
